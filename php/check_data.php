<?php
session_start();
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../log/error.log');
error_reporting(E_ALL);

header('Content-Type: application/json');
require_once __DIR__ . '/db.php';

$userID = $_SESSION['user_id'];
if (!$userID) {
    http_response_code(400);
    echo json_encode(['message' => 'Not logged in']);
    exit;
}
$userID = substr(hash('sha256', $userID), 0, 12);
$tablePrefix = "u{$userID}_";

try {
    $pdo = pdo_connect();
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $tables = [];

    $sql = "SHOW TABLES LIKE " . $pdo->quote($tablePrefix . '%');
    $stmt = $pdo->query($sql);
    $existingTables = $stmt->fetchAll();

    if (!empty($existingTables)) {
        foreach ($existingTables as $row) {
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
        
        $_SESSION['has_data'] = true;

        echo json_encode([
            "exists" => true,
            "tables" => $tables
        ]);

    } else echo json_encode([ "exists" => false ]);
    
} catch (Exception $e) {
    echo json_encode(["error" => $e->getMessage()]);
}