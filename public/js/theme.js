(function(){
  const KEY = 'theme';
  function applyTheme(value){
    if(value === 'Dark'){
      document.documentElement.classList.add('dark-theme');
      document.documentElement.classList.remove('light-theme');
    } else {
      document.documentElement.classList.remove('dark-theme');
      document.documentElement.classList.add('light-theme');
    }
    try{ localStorage.setItem(KEY, value); }catch(e){}
    updateButton();
  }
  function current(){ return (localStorage.getItem(KEY) || 'Light'); }
  function toggleTheme(){ applyTheme(current() === 'Dark' ? 'Light' : 'Dark'); }
  function updateButton(){
    const btn = document.getElementById('themeToggle');
    if(!btn) return;
    const isDark = current() === 'Dark';
    btn.textContent = isDark ? 'Light' : 'Dark';
    btn.setAttribute('aria-pressed', String(isDark));
  }
  // Expose to window for programmatic toggles
  window.livesupportTheme = { applyTheme, toggleTheme, current };
  document.addEventListener('DOMContentLoaded', ()=>{
    // Ensure button toggles
    const btn = document.getElementById('themeToggle');
    if(btn){ btn.addEventListener('click', toggleTheme); }
    updateButton();
    // apply current theme on DOM ready
    applyTheme(current());
  });
})();
