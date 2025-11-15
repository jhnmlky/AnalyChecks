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
    $stmt = $pdo->query("SELECT * FROM `$tableName`");
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

$correlationMatrix = [];
if (!empty($numericColumns) && count($numericColumns) > 1) {
    $normalizedRows = array_map(function($r) {
        $out = [];
        foreach ($r as $k => $v) {
            $out[strtolower(trim($k))] = $v;
        }
        return $out;
    }, $rows);

    $normalizedCols = array_map('strtolower', $numericColumns);

    foreach ($normalizedCols as $colA) {
        foreach ($normalizedCols as $colB) {
            if (!isset($correlationMatrix[$colA])) {
                $correlationMatrix[$colA] = [];
            }

            if ($colA === $colB) {
                $correlationMatrix[$colA][$colB] = 1.0;
                continue;
            }

            $x = [];
            $y = [];
            foreach ($normalizedRows as $r) {
                $a = $r[$colA] ?? null;
                $b = $r[$colB] ?? null;

                if (is_null($a) || is_null($b)) continue;
                if (is_numeric($a) && is_numeric($b)) {
                    $x[] = (float)$a;
                    $y[] = (float)$b;
                }
            }

            $n = count($x);
            if ($n < 2) {
                $correlationMatrix[$colA][$colB] = null;
                continue;
            }

            $meanX = array_sum($x) / $n;
            $meanY = array_sum($y) / $n;
            $num = 0; $denX = 0; $denY = 0;

            for ($i = 0; $i < $n; $i++) {
                $dx = $x[$i] - $meanX;
                $dy = $y[$i] - $meanY;
                $num += $dx * $dy;
                $denX += $dx ** 2;
                $denY += $dy ** 2;
            }

            $den = sqrt($denX * $denY);
            $correlationMatrix[$colA][$colB] = ($den == 0) ? null : $num / $den;
        }
    }
}

$prettyMatrix = [];
foreach ($correlationMatrix as $a => $row) {
    $cleanA = preg_replace('/[^A-Za-z0-9_]/', '_', strtolower($a));
    foreach ($row as $b => $val) {
        $cleanB = preg_replace('/[^A-Za-z0-9_]/', '_', strtolower($b));
        $prettyMatrix[$cleanA][$cleanB] = $val;
    }
}
$correlationMatrix = $prettyMatrix;

echo json_encode([
    'table' => $table,
    'columns' => $columns,
    'rows' => $rows,
    'correlation' => $correlationMatrix
], JSON_UNESCAPED_UNICODE);