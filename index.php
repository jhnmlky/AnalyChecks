<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <title>AnalyChecks</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="style/index.css">
</head>
<body>
    <main>
        <?php
        session_start();
        if (isset($_SESSION['username'])) {
            $username = $_SESSION['username'];
            header("Location: home.php");
            exit;
        }
        if (isset($_SESSION['error'])) {
            $errorMessage = $_SESSION['error'];
            unset($_SESSION['error']);
        } else {
            $errorMessage = '';
        }
        if (isset($_SESSION['signup'])) {
            $successMessage = $_SESSION['signup'];
            unset($_SESSION['signup']);
        } else {
            $successMessage = '';
        }
        ?>
        <div class="column left">
            <img class="logo" src="image/logo.png">
            <h1>LOG IN</h1>
        </div>
        <div class="column right">
            <form method="POST" action="php/login.php" onsubmit="return validateForm()" autocomplete="off">
                <?php if (!empty($errorMessage)) : ?>
                    <p class="error"><?php echo $errorMessage; ?></p>
                <?php endif; ?>
                <?php if (!empty($successMessage)) : ?>
                    <p class="success"><?php echo $successMessage; ?></p>
                <?php endif; ?>
                <div class="field">
                    <label for="username">Username:</label>
                    <input id="username" type="text" name="username">
                </div>
                <div class="field">
                    <label for="password">Password:</label>
                    <input id="password" type="password" name="password">
                    <img id="toggle" src="image/eye_open.png" class="eye-icon">
                </div>
                <div class="field buttons">
                    <button type="submit">Log In</button>
                    <div class="register" onclick="register()">Register</div>
                </div>
            </form>
        </div>
    </main>
    <footer>BASUEL . All rights reserved . Oct 2025</footer>
    <script src="script/index.js"></script>
</body>
</html>