<?php
$DB_HOST = '127.0.0.1';
$DB_PORT = '3306';
$DB_USER = 'root';
$DB_PASS = '';

function pdo_connect($dbname = "analychecks") {
    global $DB_HOST, $DB_PORT, $DB_USER, $DB_PASS;
    $dsn = "mysql:host={$DB_HOST};port={$DB_PORT}";
    if ($dbname) $dsn .= ";dbname={$dbname}";
    $opts = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4"
    ];
    return new PDO($dsn, $DB_USER, $DB_PASS, $opts);
}