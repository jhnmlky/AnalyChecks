function login() {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
}

function validateForm() {
    var username = document.getElementById('username');
    var email = document.getElementById('email');
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var password = document.getElementById('password');
    if (username.value.trim() === '' || /\s/.test(username.value.trim())) {
        username.style.borderBottomWidth = '1px';
        username.style.borderBottomColor = 'red';
        if (/\s/.test(username.value.trim())) {
            document.getElementById('username-error').style.display = 'block';
        }
    } else {
        username.style.borderBottomWidth = '';
        username.style.borderBottomColor = '';
        document.getElementById('username-error').style.display = 'none';
    }
    if (email.value.trim() === '' || !pattern.test(email.value.trim())) {
        email.style.borderBottomWidth = '1px';
        email.style.borderBottomColor = 'red';
    } else {
        email.style.borderBottomWidth = '';
        email.style.borderBottomColor = '';
    }
    if (password.value.trim() === '') {
        password.style.borderBottomWidth = '1px';
        password.style.borderBottomColor = 'red';
    } else {
        password.style.borderBottomWidth = '';
        password.style.borderBottomColor = '';
    }
    if (username.value.trim() === '' || email.value.trim() === '' || !pattern.test(email.value.trim()) || password.value.trim() === '') {
        return false;
    }
    return true;
}