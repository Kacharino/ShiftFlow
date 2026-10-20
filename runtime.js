/* Shift Flow – MVP-Prototyp: kleine Laufzeit für die Screen-Vorlagen.
   Liest die Vorlage aus <x-dc>, rendert {{ }}-Platzhalter, <sc-for> und <sc-if>
   und zeichnet bei jedem setState() neu. Keine Abhängigkeiten. */
(function () {
  'use strict';
  var HOLE_ALL = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/;
  var HOLE = /\{\{\s*([\w.]+)\s*\}\}/g;
  var BOOL_ATTRS = { disabled: 1, checked: 1, required: 1, readonly: 1, selected: 1, hidden: 1 };
  var EVENT_MAP = { click: 'click', change: 'input', input: 'input', mousedown: 'mousedown', mouseup: 'mouseup', mouseenter: 'mouseenter', keydown: 'keydown', submit: 'submit', blur: 'blur', focus: 'focus' };

  function lookup(path, scope) {
    var parts = path.split('.'), cur;
    for (var i = scope.length - 1; i >= 0; i--) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], parts[0])) { cur = scope[i][parts[0]]; break; }
    }
    for (var j = 1; j < parts.length && cur != null; j++) cur = cur[parts[j]];
    return cur;
  }
  function str(v) { return v == null || v === false ? '' : String(v); }

  window.DCLogic = function DCLogic(props) { this.props = props || {}; this.state = {}; };
  window.DCLogic.prototype.setState = function (patch) {
    if (typeof patch === 'function') patch = patch(this.state);
    Object.assign(this.state, patch);
    if (this.__schedule) this.__schedule();
  };

  function build(node, scope, out) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      out.push(document.createTextNode(t.indexOf('{{') < 0 ? t : t.replace(HOLE, function (_, p) { return str(lookup(p, scope)); })));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-for') {
      var m = HOLE_ALL.exec(node.getAttribute('list') || ''), list = m ? lookup(m[1], scope) : null, as = node.getAttribute('as') || 'item';
      (list || []).forEach(function (item) {
        var s = {}; s[as] = item;
        var sc = scope.concat([s]);
        node.childNodes.forEach(function (c) { build(c, sc, out); });
      });
      return;
    }
    if (tag === 'sc-if') {
      var mv = HOLE_ALL.exec(node.getAttribute('value') || '');
      if (mv && lookup(mv[1], scope)) node.childNodes.forEach(function (c) { build(c, scope, out); });
      return;
    }
    var el = node.cloneNode(false), deferredValue;
    Array.prototype.slice.call(node.attributes).forEach(function (a) {
      var name = a.name, val = a.value;
      if (name.indexOf('hint-placeholder') === 0 || name === 'key') { el.removeAttribute(name); return; }
      if (name.length > 2 && name.indexOf('on') === 0) {
        el.removeAttribute(name);
        var mf = HOLE_ALL.exec(val), fn = mf ? lookup(mf[1], scope) : null, ev = EVENT_MAP[name.slice(2)] || name.slice(2);
        if (ev === 'input' && (tag === 'select' || (tag === 'input' && /^(checkbox|radio)$/.test(node.getAttribute('type') || '')))) ev = 'change';
        if (typeof fn === 'function') el.addEventListener(ev, function (e) { fn(e); });
        return;
      }
      if (val.indexOf('{{') < 0) return;
      var whole = HOLE_ALL.exec(val), v = whole ? lookup(whole[1], scope) : val.replace(HOLE, function (_, p) { return str(lookup(p, scope)); });
      if (BOOL_ATTRS[name]) { if (v && v !== 'false') el.setAttribute(name, ''); else el.removeAttribute(name); return; }
      if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) { el.removeAttribute('value'); deferredValue = str(v); return; }
      el.setAttribute(name, str(v));
    });
    var kids = [];
    node.childNodes.forEach(function (c) { build(c, scope, kids); });
    kids.forEach(function (k) { el.appendChild(k); });
    if (deferredValue !== undefined) el.value = deferredValue;
    out.push(el);
  }

  function pathOf(el, root) { var p = []; while (el && el !== root) { p.unshift(Array.prototype.indexOf.call(el.parentNode.children, el)); el = el.parentNode; } return p; }
  function atPath(root, p) { var el = root; for (var i = 0; i < p.length && el; i++) el = el.children[p[i]]; return el; }

  function boot() {
    var xdc = document.querySelector('x-dc');
    var script = document.querySelector('script[type="text/x-dc"]');
    if (!xdc || !script) return;
    var tpl = document.createElement('template');
    tpl.innerHTML = xdc.innerHTML;
    var helmet = tpl.content.querySelector('helmet');
    if (helmet) { Array.prototype.slice.call(helmet.childNodes).forEach(function (n) { document.head.appendChild(document.importNode(n, true)); }); helmet.remove(); }
    var host = document.createElement('div');
    host.className = 'dc-host';
    xdc.replaceWith(host);
    var Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(window.DCLogic);
    var comp = new Component({});
    var queued = false;
    function render() {
      queued = false;
      var vals = comp.renderVals();
      var act = document.activeElement, focusId = act && act.id && host.contains(act) ? act.id : null, selS = null, selE = null;
      try { if (focusId) { selS = act.selectionStart; selE = act.selectionEnd; } } catch (e) { /* kein Textfeld */ }
      var scrolled = [];
      host.querySelectorAll('*').forEach(function (el) { if (el.scrollTop > 0) scrolled.push([pathOf(el, host), el.scrollTop]); });
      var out = [];
      tpl.content.childNodes.forEach(function (c) { build(c, [vals], out); });
      host.textContent = '';
      out.forEach(function (n) { host.appendChild(n); });
      scrolled.forEach(function (s) { var el = atPath(host, s[0]); if (el) el.scrollTop = s[1]; });
      if (focusId) { var f = document.getElementById(focusId); if (f) { f.focus(); try { if (selS != null) f.setSelectionRange(selS, selE); } catch (e) { /* kein Textfeld */ } } }
    }
    comp.__schedule = function () { if (!queued) { queued = true; Promise.resolve().then(render); } };
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
