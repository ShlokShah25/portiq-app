/* PortIQ landing page: menu toggle, click-to-play videos, and the language card. No dependencies. */
(function () {
  'use strict';

  // Mobile menu
  var toggle = document.querySelector('.nav__toggle');
  var links = document.getElementById('navlinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        links.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Videos: big play button over the poster, native controls once playing
  document.querySelectorAll('[data-video]').forEach(function (box) {
    var video = box.querySelector('video');
    var btn = box.querySelector('.video__play');
    if (!video || !btn) return;
    btn.addEventListener('click', function () { video.play(); });
    video.addEventListener('play', function () { box.classList.add('is-playing'); });
  });
  document.querySelectorAll('[data-play]').forEach(function (a) {
    a.addEventListener('click', function () {
      var v = document.getElementById(a.getAttribute('data-play'));
      if (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    });
  });

  // One decision, eight languages
  var morph = document.querySelector('[data-morph]');
  if (morph) {
    var line = morph.querySelector('[data-morph-line]');
    var label = morph.querySelector('[data-morph-lang]');
    var items = [].slice.call(morph.querySelectorAll('.morph__all li'));
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !items.length || !('IntersectionObserver' in window)) {
      morph.classList.add('is-static'); // show all eight as a plain list
    } else {
      var i = 0, timer = null;
      var show = function () {
        i = (i + 1) % items.length;
        line.classList.add('is-out');
        setTimeout(function () {
          line.textContent = items[i].textContent;
          line.lang = items[i].lang;
          label.textContent = items[i].getAttribute('data-lang');
          line.classList.remove('is-out');
        }, 230);
      };
      new IntersectionObserver(function (entries) {
        var on = entries[0].isIntersecting;
        if (on && !timer) timer = setInterval(show, 1700);
        if (!on && timer) { clearInterval(timer); timer = null; }
      }, { threshold: 0.4 }).observe(morph);
    }
  }
})();
