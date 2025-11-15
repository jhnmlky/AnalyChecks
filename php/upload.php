<?php
session_start();
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../log/error.log');
error_reporting(E_ALL);

header('Content-Type: application/json');
require_once __DIR__ . '/db.php';

$payloadTables = $_POST['tables'] ?? '[]';
$userID = $_SESSION['user_id'];
if (!$userID) {
    http_response_code(400);
    echo json_encode(['message' => 'Not logged in']);
    exit;
}
$userID = substr(hash('sha256', $userID), 0, 12);
$tablePrefix = "u{$userID}_";

$payloadTables = json_decode($payloadTables, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['message' => "JSON decode error: " . json_last_error_msg()]);
    exit;
}

try {
    $pdo = pdo_connect();
    $response = ['tables' => [], 'relations' => []];

    $stmt = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($tablePrefix . '%'));
    $existingTables = $stmt->fetchAll(PDO::FETCH_COLUMN);
    if ($existingTables) {
        foreach ($existingTables as $existingTable) {
            $pdo->exec("DROP TABLE IF EXISTS `$existingTable`");
        }
    }

    function safe_ident($s) {
        $s = preg_replace('/[^A-Za-z0-9_]/', '_', $s);
        if (!preg_match('/^[A-Za-z]/', $s)) $s = 't_' . $s;
        return substr($s,0,64);
    }

    function normalize_inferred_type($name, $type, $sampleValues = []) {
        $lname = strtolower($name);
        $type  = strtoupper(trim($type));
        if ($lname === '') return 'TEXT';
        if ($type === 'DATETIME') {
            $hasYear = false;
            foreach ($sampleValues as $v) {
                if (preg_match('/\b\d{4}\b/', (string)$v)) { $hasYear = true; break; }
            }
            if (!$hasYear) return 'DATETIME';
        }
        if (preg_match('/(?:^|_)(postal|zip|code|id|contact|phone|no|num|ssn)(?:_|$)/i', $lname)) {
            return 'TEXT';
        }
        if (in_array($type, ['INT','DOUBLE'])) {
            $numCount = 0; $txtCount = 0;
            foreach ($sampleValues as $v) {
                if ($v === null || $v === '') continue;
                if (is_numeric($v)) $numCount++; else $txtCount++;
            }
            if ($txtCount > 0 && $numCount > 0) return 'TEXT';
        }
        return $type ?: 'TEXT';
    }

    foreach ($payloadTables as $table) {
        $tname = safe_ident($table['tableName']);
        $columns = $table['columns'];
        $rows = $table['rows'];

        foreach ($columns as &$col) {
            $samples = array_column($rows, $col['name']);
            $col['type'] = normalize_inferred_type($col['name'], $col['type'], $samples);
        }
        unset($col);

        if (count($columns) === 0) continue;

        $colDefs = [];
        $pk = null;
        foreach ($columns as $col) {
            $candidate = safe_ident($col['name']);
            if (preg_match('/id$/i', $candidate)) {
                $pk = $candidate;
                break;
            }
        }

        foreach ($columns as $idx => $col) {
            $cname = safe_ident($col['name']);
            $ctype = strtoupper($col['type'] ?? 'TEXT');

            switch ($ctype) {
                case 'INT':     $sqltype = 'INT'; break;
                case 'DOUBLE':  $sqltype = 'DOUBLE'; break;
                case 'DATETIME': $sqltype = 'DATETIME'; break;
                default:        $sqltype = 'TEXT'; break;
            }

            if ($cname === $pk) {
                if ($sqltype === 'TEXT') {
                    $allInteger = true;
                    foreach ($rows as $r) {
                        $v = $r[$idx] ?? null;
                        if ($v === null || $v === '') continue;
                        if (!is_numeric($v) || intval($v) != $v) {
                            $allInteger = false;
                            break;
                        }
                    }
                    if ($allInteger) {
                        $sqltype = 'INT';
                    } else {
                        $sqltype = 'VARCHAR(191)';
                    }
                }

                $colDefs[] = "`{$cname}` {$sqltype} NOT NULL";
            } else {
                if (in_array($sqltype, ['INT','DOUBLE','DATETIME'])) {
                    $colDefs[] = "`{$cname}` {$sqltype} DEFAULT NULL";
                } else {
                    $colDefs[] = "`{$cname}` TEXT DEFAULT NULL";
                }
            }
        }

        if (!$pk) {
            array_unshift($colDefs, "`_auto_id` INT NOT NULL AUTO_INCREMENT");
            $pk = "_auto_id";
        }

        $tableName = $tablePrefix . $tname;

        try {
            $createSql = "CREATE TABLE `$tableName` (" . implode(", ", $colDefs) . ", PRIMARY KEY(`$pk`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
            $pdo->exec($createSql);
        } catch (Exception $e) {
            throw new Exception("Failed creating table {$tname}: " . $e->getMessage());
        }

        $colNames = array_map(function($c){ return "`".safe_ident($c['name'])."`"; }, $columns);
        $placeholders = implode(',', array_fill(0, count($columns), '?'));
        $insertSql = "INSERT INTO `$tableName` (". implode(',', $colNames) .") VALUES ({$placeholders})";
        $stmt = $pdo->prepare($insertSql);

        $pdo->beginTransaction();
        try {
            foreach ($rows as $row) {
                $params = [];
                for ($i=0;$i<count($columns);$i++){
                    $v = $row[$i] ?? null;
                    if ($v === '') $v = null;
                    $params[] = $v;
                }
                $stmt->execute($params);
            }
            $pdo->commit();
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }

        $cnt = $pdo->query("SELECT COUNT(*) AS c FROM `$tableName`")->fetch(PDO::FETCH_ASSOC)['c'];
        $colsMeta = [];
        foreach ($columns as $col) {
            $colsMeta[] = ['name' => safe_ident($col['name']), 'type' => strtoupper($col['type'] ?? 'TEXT')];
        }
        $response['tables'][] = ['tableName' => $tname, 'row_count' => (int)$cnt, 'columns' => $colsMeta];
    }

    $tables = $response['tables'];
    $relations = [];
    for ($i=0;$i<count($tables);$i++){
        for ($j=0;$j<count($tables);$j++){
            if ($i === $j) continue;
            $A = $tables[$i];
            $B = $tables[$j];
            foreach ($A['columns'] as $acol) {
                foreach ($B['columns'] as $bcol) {
                    $aName = $acol['name']; $bName = $bcol['name'];
                    try {
                        $distinctA = (int)$pdo->query("SELECT COUNT(DISTINCT `{$aName}`) AS c FROM `{$A['tableName']}` WHERE `{$aName}` IS NOT NULL")->fetch(PDO::FETCH_ASSOC)['c'];
                        $distinctB = (int)$pdo->query("SELECT COUNT(DISTINCT `{$bName}`) AS c FROM `{$B['tableName']}` WHERE `{$bName}` IS NOT NULL")->fetch(PDO::FETCH_ASSOC)['c'];
                        if ($distinctA === 0 || $distinctB === 0) continue;
                        $sharedSql = "SELECT COUNT(DISTINCT a.`{$aName}`) AS shared FROM `{$A['tableName']}` a JOIN (SELECT DISTINCT `{$bName}` as val FROM `{$B['tableName']}` WHERE `{$bName}` IS NOT NULL) b ON a.`{$aName}` = b.val WHERE a.`{$aName}` IS NOT NULL";
                        $shared = (int)$pdo->query($sharedSql)->fetch(PDO::FETCH_ASSOC)['shared'];
                        if ($shared <= 0) continue;
                        $ratio = $shared / min($distinctA, $distinctB);
                        if ($ratio >= 0.25 || $shared >= 3 || strtolower($aName) === strtolower($bName.'_id') || strtolower($bName) === strtolower($aName.'_id')) {
                            $relations[] = [
                                'from_table' => $A['tableName'],
                                'from_column' => $aName,
                                'to_table' => $B['tableName'],
                                'to_column' => $bName,
                                'shared' => $shared,
                                'ratio' => $ratio
                            ];
                        }
                    } catch (Exception $e) {}
                }
            }
        }
    }
    
    $_SESSION['has_data'] = true;

    $response['relations'] = $relations;
    echo json_encode($response);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['message' => 'Server error: '.$e->getMessage()]);
    exit;
}