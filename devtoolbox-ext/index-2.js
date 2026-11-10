(function () {
  'use strict';

  var input = document.getElementById('search');
  var cards = Array.prototype.slice.call(document.querySelectorAll('#grid .tool-card'));
  var noResult = document.getElementById('noResult');

  function normalize(s) {
    return String(s).toLowerCase().replace(/\s+/g, '');
  }

  input.addEventListener('input', function () {
    var q = normalize(input.value);
    var visible = 0;

    cards.forEach(function (card) {
      var hay = normalize(card.querySelector('h2').textContent + ' ' + (card.dataset.keys || ''));
      var hit = !q || hay.indexOf(q) !== -1;
      card.style.display = hit ? '' : 'none';
      if (hit) visible++;
    });

    noResult.classList.toggle('show', visible === 0);
  });

  // 回车直接打开第一个匹配的工具
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var first = cards.filter(function (c) { return c.style.display !== 'none'; })[0];
    if (first && first.tagName === 'A') location.href = first.getAttribute('href');
  });

  input.focus();
})();
