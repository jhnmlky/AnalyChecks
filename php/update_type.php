<?php
session_start();
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../log/error.log');
error_reporting(E_ALL);

header('Content-Type: application/json');
require_once __DIR__ . '/db.php';

$table = $_POST['table'] ?? '';
$changes = $_POST['changes'] ?? '';

$userID = $_SESSION['user_id'];
if (!$userID) {
    http_response_code(400);
    echo json_encode(['message' => 'Not logged in']);
    exit;
}
$userID = substr(hash('sha256', $userID), 0, 12);

if (!$table || !$changes) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing parameters.']);
    exit;
}

$changes = json_decode($changes, true);
if (!is_array($changes)) {
    echo json_encode(['success' => false, 'message' => 'Invalid data']);
    exit;
}

$tablePrefix = "u{$userID}_";
$tableName = $tablePrefix . $table;

try {
    $pdo = pdo_connect();
    $stmt = $pdo->query("SHOW COLUMNS FROM `$tableName`");
    $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($changes as $colIdx => $newType) {
        $colIdx = (int)$colIdx;
        $newType = strtoupper(trim($newType));

        if (!isset($columns[$colIdx])) {
            throw new Exception('Invalid column index.');
        }

        $col = $columns[$colIdx];
        $colName = $col['Field'];
        $oldType = strtoupper($col['Type']);

        $sqlType = match ($newType) {
            'INT' => 'INT',
            'DOUBLE' => 'DOUBLE',
            'TEXT' => 'TEXT',
            'DATETIME' => 'DATETIME',
            default => $oldType
        };

        $alterSql = "ALTER TABLE `$tableName` MODIFY `$colName` $sqlType";
        $pdo->exec($alterSql);
    }

    $tables = [];
    foreach ($pdo->query("SHOW TABLES LIKE " . $pdo->quote($tablePrefix . '%')) as $row) {
        $tname = $row[0];
        $colInfo = [];

        foreach ($pdo->query("SHOW COLUMNS FROM `$tname`") as $col) {
            $mysqlType = strtolower($col['Type']);
            $lname = strtolower($col['Field']);
            $simpleType = 'TEXT';

            if (preg_match('/(?:^|_)(postal|zip|code|id|contact|phone|no|num|ssn)(?:_|$)/i', $lname)) {
                $simpleType = 'TEXT';
            }
            elseif (preg_match('/int|tinyint|smallint|mediumint|bigint/', $mysqlType)) {
                $simpleType = 'INT';
            } elseif (preg_match('/double|decimal|float|real/', $mysqlType)) {
                $simpleType = 'DOUBLE';
            } elseif (preg_match('/date|time|year/', $mysqlType)) {
                $simpleType = 'DATETIME';
            } elseif (preg_match('/char|text|blob|enum|set/', $mysqlType)) {
                $simpleType = 'TEXT';
            }

            $colInfo[] = [
                "name" => $col['Field'],
                "type" => $simpleType
            ];
        }

        try {
            $rowCount = (int)$pdo->query("SELECT COUNT(*) FROM `$tname`")->fetchColumn();
        } catch (Exception $e) {
            $rowCount = 0;
        }

        $tables[] = [
            "tableName" => str_replace($tablePrefix, '', $tname),
            "columns" => $colInfo,
            "row_count" => $rowCount
        ];
    }

    echo json_encode([
        'success' => true,
        'tables' => $tables
    ], JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'error' => $e->getMessage()
    ]);
}