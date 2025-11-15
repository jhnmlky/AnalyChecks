<?php
session_start();
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../log/error.log');
error_reporting(E_ALL);

header('Content-Type: application/json');
require_once __DIR__ . '/db.php';

$x = $_POST['x'] ?? '';
$yCols = $_POST['y'] ?? [];
$userID = $_SESSION['user_id'];
if (!$userID) {
    http_response_code(400);
    echo json_encode(['message' => 'Not logged in']);
    exit;
}
$userID = substr(hash('sha256', $userID), 0, 12);
$tablePrefix = "u{$userID}_";

if (!$x || empty($yCols)) {
    echo json_encode(['error' => 'Missing parameters']);
    exit;
}

if (strpos($x, '.') === false) {
    echo json_encode(['error' => 'Invalid X column format']);
    exit;
}
list($xTable, $xCol) = explode('.', $x, 2);
$tableNameX = $tablePrefix . $xTable;

try {
    $pdo = pdo_connect();

    $getColInfo = function($pdo, $table, $col) {
        $info = $pdo->query("SHOW COLUMNS FROM `$table` LIKE '$col'")->fetch(PDO::FETCH_ASSOC);
        if (!$info) return [null, null, false];
        $colName = $info['Field'];
        $colType = $info['Type'];
        $isNumeric = preg_match('/int|decimal|double|float/i', $colType)
            && !preg_match('/(?:^|_)(postal|zip|code|id|contact|phone|no|num|ssn)(?:_|$)/i', $colName);
        return [$colName, $colType, $isNumeric];
    };

    $xValues = $pdo->query("
        SELECT DISTINCT `$xCol` AS x
        FROM `$tableNameX`
        WHERE `$xCol` IS NOT NULL
        ORDER BY `$xCol`
        LIMIT 500
    ")->fetchAll(PDO::FETCH_COLUMN);

    $series = [];

    foreach ($yCols as $yFull) {
        if (strpos($yFull, '.') === false) continue;
        list($yTable, $yCol) = explode('.', $yFull, 2);
        $tableNameY = $tablePrefix . $yTable;
        $yCol = $yCol;

        [$colName, $colType, $isNumeric] = $getColInfo($pdo, $tableNameY, $yCol);
        if (!$colName) continue;

        $aggFunc = $isNumeric ? 'SUM' : 'COUNT';

        $joinKey = null;
        if ($xTable !== $yTable) {
            $xCols = $pdo->query("SHOW COLUMNS FROM `$tableNameX`")->fetchAll(PDO::FETCH_COLUMN);
            $yColsInTable = $pdo->query("SHOW COLUMNS FROM `$tableNameY`")->fetchAll(PDO::FETCH_COLUMN);
            foreach ($xCols as $col) {
                if (in_array($col, $yColsInTable)) {
                    $joinKey = $col;
                    break;
                }
            }
        }

        if ($xTable === $yTable) {
            $sql = "
                SELECT `$xCol` AS x, $aggFunc(`$yCol`) AS y
                FROM `$tableNameX`
                WHERE `$xCol` IS NOT NULL AND `$yCol` IS NOT NULL
                GROUP BY `$xCol`
                ORDER BY `$xCol`
                LIMIT 500
            ";
        } elseif ($joinKey) {
            $sql = "
                SELECT a.`$xCol` AS x, $aggFunc(b.`$yCol`) AS y
                FROM `$tableNameX` a
                JOIN `$tableNameY` b ON a.`$joinKey` = b.`$joinKey`
                GROUP BY a.`$xCol`
                ORDER BY a.`$xCol`
                LIMIT 500
            ";
        } else {
            continue;
        }

        $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

        $yValues = array_map(
            fn($r) => is_numeric($r['y']) ? (float)$r['y'] : null,
            $rows
        );

        $series[] = [
            'label' => strtoupper($yTable . '.' . str_replace('_', ' ', $yCol)),
            'data'  => $yValues
        ];
    }

    echo json_encode(['x' => $xValues, 'series' => $series], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    echo json_encode(['error'=>$e->getMessage()]);
}