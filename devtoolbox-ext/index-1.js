/* 首页默认浅色（除非用户手动切换过主题） */
try {
  if (!localStorage.getItem('devtoolbox.theme.v1')) TB.setTheme('light');
} catch (e) {}
