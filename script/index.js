var toggle = document.getElementById('toggle');
toggle.addEventListener('click', function() {
    if (password.type === 'password') {
        password.type = 'text';
        toggle.src = 'image/eye_close.png';
    } else {
        password.type = 'password';
        toggle.src = 'image/eye_open.png';
    }
});

function register() {
    window.location.href = 'register.php';
}

function validateForm() {
    var username = document.getElementById('username');
    var password = document.getElementById('password');
    if (username.value.trim() === '') {
        username.style.borderBottomWidth = '1px';
        username.style.borderBottomColor = 'red';
    } else {
        username.style.borderBottomWidth = '';
        username.style.borderBottomColor = '';
    }
    if (password.value.trim() === '') {
        password.style.borderBottomWidth = '1px';
        password.style.borderBottomColor = 'red';
    } else {
        password.style.borderBottomWidth = '';
        password.style.borderBottomColor = '';
    }
    if (username.value.trim() === '' || password.value.trim() === '') {
        return false;
    }
    return true;
}