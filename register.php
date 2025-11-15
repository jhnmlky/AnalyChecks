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
        if (isset($_SESSION['error'])) {
            $errorMessage = $_SESSION['error'];
            unset($_SESSION['error']);
        } else {
            $errorMessage = '';
        }
        ?>
        <div class="column left">
            <img class="logo" src="image/logo.png">
            <h1>REGISTER</h1>
        </div>
        <div class="column right">
            <form method="POST" action="php/register.php" onsubmit="return validateForm()" autocomplete="off">
                <div class="field">
                    <label for="username">Username:</label>
                    <input id="username" type="text" name="username">
                    <p id="username-error" class="username-error" style="display:none;">Username may not contain spaces</p>
                </div>
                <div class="field">
                    <label for="email">Email:</label>
                    <input id="email" type="email" name="email">
                </div>
                <div class="field">
                    <label for="password">Password:</label>
                    <input id="password" type="text" name="password" minlength="8">
                </div>
                <?php if (!empty($errorMessage)) : ?>
                    <p class="error"><?php echo $errorMessage; ?></p>
                <?php endif; ?>
                <div class="field buttons">
                    <button type="submit">Register</button>
                    <div class="login" onclick="login()">Login</div>
                </div>
            </form>
        </div>
    </main>
    <footer>BASUEL . All rights reserved . Oct 2025</footer>
    <script src="script/register.js"></script>
</body>
</html>