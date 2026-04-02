document.addEventListener('DOMContentLoaded', () => {
  const theme = localStorage.getItem('theme') || 'Light';
  applyTheme(theme);

  // Optional: update the appearance select in settings page
  const themeSelect = document.getElementById('theme');
  if (themeSelect) themeSelect.value = theme;
});

function applyTheme(theme) {
  if (theme === 'Dark') {
    document.body.style.background = '#1e1e1e';
    document.body.style.color = '#ffffff';
  } else {
    document.body.style.background = '#ffffff';
    document.body.style.color = '#000000';
  }
}