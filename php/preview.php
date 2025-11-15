<?php
session_start();
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../log/error.log');
error_reporting(E_ALL);

header('Content-Type: application/json');
require_once __DIR__ . '/db.php';

$table = $_GET['table'] ?? '';
$userID = $_SESSION['user_id'];
if (!$userID) {
    http_response_code(400);
    echo json_encode(['message' => 'Not logged in']);
    exit;
}
$userID = substr(hash('sha256', $userID), 0, 12);

if (!$table) {
    echo json_encode(['error' => 'Missing parameters']);
    exit;
}

$tableName = "u{$userID}_" . $table;

try {
    $pdo = pdo_connect();
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (Exception $ex) {
    echo json_encode(['error' => 'DB connection error: ' . $ex->getMessage()]);
    exit;
}

try {
    $stmt = $pdo->query("SELECT * FROM `$tableName` LIMIT 10000");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $colQuery = $pdo->query("SHOW FIELDS FROM `$tableName`");
    $columns = [];
    while ($c = $colQuery->fetch(PDO::FETCH_ASSOC)) {
        $mysqlType = strtolower($c['Type']);
        $lname = strtolower($c['Field']);
        $mappedType = 'TEXT';

        if (preg_match('/(?:^|_)(postal|zip|code|id|contact|phone|no|num|ssn)(?:_|$)/i', $lname)) {
            $mappedType = 'TEXT';
        }
        elseif (preg_match('/int|tinyint|smallint|mediumint|bigint/', $mysqlType)) {
            $mappedType = 'INT';
        } elseif (preg_match('/double|decimal|float|real/', $mysqlType)) {
            $mappedType = 'DOUBLE';
        } elseif (preg_match('/date|time|year/', $mysqlType)) {
            $mappedType = 'DATETIME';
        } elseif (preg_match('/char|text|blob|enum|set/', $mysqlType)) {
            $mappedType = 'TEXT';
        }

        $columns[] = ['name' => $c['Field'], 'type' => strtoupper($mappedType)];
    }

} catch (Exception $ex) {
    echo json_encode(['error' => 'Query failed: ' . $ex->getMessage()]);
    exit;
}

if (!$rows) {
    echo json_encode(['table' => $table, 'columns' => $columns, 'rows' => []]);
    exit;
}

$numericColumns = [];
foreach ($columns as $col) {
    $name = $col['name'];
    $type = strtoupper($col['type']);
    $lname = strtolower($name);

    if ($type !== 'INT' && $type !== 'DOUBLE') continue;

    $vals = array_column($rows, $name);
    $numeric = array_filter($vals, fn($v) => is_numeric($v));
    if (!count($numeric)) continue;

    $numericColumns[] = $name;
}

$duplicates = [];
if (count($columns) < 3) { $duplicates = []; } else {
    $dupQueryCols = [];
    foreach ($columns as $col) {
        $lname = strtolower($col['name']);
        if (preg_match('/(?:^|_)(id|code|no|num|postal|zip|phone|ssn)(?:_|$)/i', $lname)) continue;
        $dupQueryCols[] = "`{$col['name']}`";
    }
    if (count($dupQueryCols) > 0) {
        $colExpr = implode(',', $dupQueryCols);

        try {
            $dupSql = "SELECT $colExpr, COUNT(*) AS dup_count
                    FROM `$tableName`
                    GROUP BY $colExpr
                    HAVING dup_count > 1";
            $dupStmt = $pdo->query($dupSql);
            $dupGroups = $dupStmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($dupGroups as $group) {
                $matchCols = array_diff_key($group, ['dup_count' => true]);

                foreach ($rows as $idx => $r) {
                    $same = true;
                    foreach ($matchCols as $colName => $val) {
                        $colName = trim($colName, '`');
                        $rVal = $r[$colName] ?? '';
                        if ((string)$rVal !== (string)$val) {
                            $same = false;
                            break;
                        }
                    }
                    if ($same) {
                        $duplicates[] = $idx;
                    }
                }
            }
            $duplicates = array_values(array_unique($duplicates));
        } catch (Exception $e) {
            $duplicates = [];
        }
    }
}

$summary = [];
foreach ($columns as $col) {
    $name = $col['name'];
    $type = strtoupper($col['type']);

    if ($type !== 'INT' && $type !== 'DOUBLE') continue;

    $vals = array_column($rows, $name);
    $numeric = array_filter($vals, fn($v) => is_numeric($v));
    if (!count($numeric)) continue;

    $numeric = array_map('floatval', $numeric);
    sort($numeric, SORT_NUMERIC);

    $mean = array_sum($numeric) / count($numeric);
    $count = count($numeric);
    $median = $numeric[(int)floor($count / 2)];
    $modeArr = array_count_values(array_map('strval', $numeric));
    arsort($modeArr);
    $modeVal = array_key_first($modeArr);

    $summary[$name] = [
        'mean' => $mean
    ];
}

$outliers = [];
if (!empty($numericColumns)) {
    foreach ($numericColumns as $colName) {
        $stats = $summary[$colName] ?? null;
        if (!$stats) continue;
        $vals = array_filter(array_column($rows, $colName), 'is_numeric');
        if (count($vals) < 2) continue;
        $vals = array_map('floatval', $vals);
        $mean = $stats['mean'];
        $std = sqrt(array_sum(array_map(fn($v) => pow($v - $mean, 2), $vals)) / count($vals));
        if ($std == 0) continue;
        foreach ($rows as $i => $r) {
            $v = $r[$colName];
            if (is_numeric($v) && abs($v - $mean) > 3 * $std) {
                $outliers[$i][$colName] = true;
            }
        }
    }
}

echo json_encode([
    'table' => $table,
    'columns' => $columns,
    'rows' => $rows,
    'duplicates' => $duplicates,
    'outliers' => $outliers
], JSON_UNESCAPED_UNICODE);