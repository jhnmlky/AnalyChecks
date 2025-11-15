<?php
session_start();
header('Content-Type: application/json');
echo json_encode([
  'user_id' => $_SESSION['user_id'] ?? null,
  'username' => $_SESSION['username'] ?? null,
  'has_data' => $_SESSION['has_data'] ?? false
]);
?>