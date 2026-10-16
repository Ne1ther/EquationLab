// MathLive 0.111.1 keeps MacroAtom.macroArgs separately from its editable body.
// Preserve the native command/hidden fields while committing edits in visible
// arguments before getValue(), validation, export or an undo checkpoint.
(function (host) {
  'use strict';
  const definitions = new Map();
  const installed = new WeakSet();
  const markerPrefix = 'equationlab-owner=';

  function directChildren(atom) {
    const children = [];
    if (atom?._branches) { for (const branch of Object.values(atom._branches)) if (Array.isArray(branch)) children.push(...branch); }
    else if (Array.isArray(atom?.body)) children.push(...atom.body);
    if (Array.isArray(atom?._rows)) for (const row of atom._rows) if (Array.isArray(row)) for (const cell of row) if (Array.isArray(cell)) children.push(...cell);
    return children;
  }

  function marker(atom) {
    if (atom?.command !== '\\htmlData' || typeof atom.args?.[0] !== 'string') return null;
    const values = Object.fromEntries(atom.args[0].split(',').map(part => { const at = part.indexOf('='); return [part.slice(0, at).trim(), part.slice(at + 1).trim()]; }));
    const owner = values['equationlab-owner'], index = Number(values['equationlab-arg']);
    return definitions.has(owner) && Number.isInteger(index) && index >= 1 && index <= 9 ? {owner,index} : null;
  }

  function groupAt(text, start) {
    if (text[start] !== '{') return null;
    let depth = 1, index = start + 1;
    while (index < text.length) {
      const c = text[index++];
      if (c === '\\') { if (index < text.length) index++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return {value:text.slice(start + 1,index - 1),end:index};
    }
    throw Error('Unclosed editable macro argument');
  }

  function originalArguments(text, count) {
    const values = []; let index = 0;
    for (let arg = 0; arg < count; arg++) {
      while (/\s/.test(text[index] || '') && index < text.length) index++;
      if (index >= text.length) throw Error('Missing editable macro argument');
      const group = groupAt(text,index);
      if (group) { values.push(group.value); index = group.end; continue; }
      const start = index++;
      if (text[start] === '\\') {
        if (/[A-Za-z]/.test(text[index] || '')) while (/[A-Za-z]/.test(text[index] || '') && index < text.length) index++;
        else if (index < text.length) index++;
      } else if (text.codePointAt(start) > 65535) index++;
      values.push(text.slice(start,index));
    }
    if (text.slice(index).trim()) throw Error('Unexpected text after editable macro arguments');
    return values;
  }

  host.safeEquationMacroLatex = function safeEquationMacroLatex(input) {
    if (typeof input !== 'string' || !input.includes('\\')) return input;
    let result = '', index = 0;
    while (index < input.length) {
      if (input[index] !== '\\') { result += input[index++]; continue; }
      const match = /^\\([A-Za-z]+)/.exec(input.slice(index));
      if (!match) { result += input.slice(index,index + 2); index += 2; continue; }
      if (match[1] === 'text' || match[1] === 'textrm') {
        let at = index + match[0].length; while (at < input.length && /\s/.test(input[at])) at++;
        let group; try { group = groupAt(input,at); } catch { /* Preserve incomplete text input. */ }
        if (group) { result += input.slice(index,group.end); index = group.end; continue; }
      }
      const definition = definitions.get(match[1]), start = index;
      index += match[0].length;
      if (!definition?.count) { result += match[0]; continue; }
      const values = []; let at = index, complete = true;
      try {
        for (let arg = 0; arg < definition.count; arg++) {
          while (at < input.length && /\s/.test(input[at])) at++;
          if (at >= input.length) { complete = false; break; }
          const group = groupAt(input,at);
          if (group) { values.push(group.value); at = group.end; continue; }
          const first = at++;
          if (input[first] === '\\') { if (/[A-Za-z]/.test(input[at] || '')) while (at < input.length && /[A-Za-z]/.test(input[at])) at++; else if (at < input.length) at++; }
          else if (input.codePointAt(first) > 65535) at++;
          values.push(input.slice(first,at));
        }
      } catch { complete = false; }
      if (!complete) { result += input.slice(start,index); continue; }
      result += match[0] + values.map(value => `{${value === '' ? '{}' : host.safeEquationMacroLatex(value)}}`).join('');
      index = at;
    }
    return result;
  };

  host.installEquationMacroEditing = function installEquationMacroEditing(mathfield) {
    if (!mathfield || installed.has(mathfield)) return;
    installed.add(mathfield);
    for (const method of ['insert','setValue']) {
      const original = mathfield[method];
      if (typeof original === 'function') Object.defineProperty(mathfield,method,{configurable:true,writable:true,value:function(value,...args) { return original.call(this,host.safeEquationMacroLatex(value),...args); }});
    }
    let owner = mathfield, descriptor;
    while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner,'value'))) owner = Object.getPrototypeOf(owner);
    if (descriptor?.set) Object.defineProperty(mathfield,'value',{configurable:true,enumerable:descriptor.enumerable,get:descriptor.get ? function() {return descriptor.get.call(this);} : undefined,set:function(value) {descriptor.set.call(this,host.safeEquationMacroLatex(value));}});
    const current = typeof mathfield.value === 'string' ? mathfield.value : null;
    if (current !== null) {
      const safe = host.safeEquationMacroLatex(current);
      if (safe !== current && typeof mathfield.setValue === 'function') {
        const selection = mathfield.selection;
        mathfield.setValue(safe,{silenceNotifications:true});
        if (selection) mathfield.selection = selection;
      }
    }
  };

  // Only our implementation markers are removed. User-authored htmlData stays
  // intact and will continue through the normal parser/capability checks.
  function withoutMarkers(text) {
    let result = '', index = 0;
    while (index < text.length) {
      if (text.startsWith('\\htmlData',index) && !/[A-Za-z]/.test(text[index + 9] || '')) {
        let at = index + 9; while (/\s/.test(text[at] || '') && at < text.length) at++;
        const data = groupAt(text,at); if (data) {
          at = data.end; while (/\s/.test(text[at] || '') && at < text.length) at++;
          const body = groupAt(text,at);
          if (body && data.value.split(',').some(part => part.trim().startsWith(markerPrefix))) { result += withoutMarkers(body.value); index = body.end; continue; }
        }
      }
      // Escaped backslashes/braces must not turn into an implementation marker.
      if (text[index] === '\\' && /[\\{}]/.test(text[index + 1] || '')) { result += text.slice(index,index + 2); index += 2; }
      else result += text[index++];
    }
    return result;
  }

  host.prepareEquationMacros = function prepareEquationMacros(source) {
    const result = {};
    for (const [key,input] of Object.entries(source || {})) {
      const name = key.replace(/^\\/,''), definition = typeof input === 'string' ? {def:input} : {...input};
      if (typeof definition.def !== 'string') { result[key] = input; continue; }
      const indices = [...definition.def.matchAll(/#([1-9])/g)].map(match => Number(match[1]));
      const count = Number.isInteger(definition.args) ? definition.args : Math.max(0,...indices);
      if (count < 0 || count > 9) throw Error('Unsupported editable macro argument count');
      const visible = new Set(indices);
      const alreadyPrepared = definition.def.includes(`equationlab-owner=${name},`);
      let body = definition.def;
      if (count && !alreadyPrepared) {
        body = body.replace(/#([1-9])/g,(parameter,digit,offset,text) => {
          let slashes = 0; for (let p = offset - 1; p >= 0 && text[p] === '\\'; p--) slashes++;
          if (slashes % 2 || text[offset - 1] === '#') return parameter;
          return `\\htmlData{equationlab-owner=${name},equationlab-arg=${digit}}{${parameter}}`;
        });
      }
      definitions.set(name,{count,visible});
      result[key] = {...definition,def:body,args:count,expand:false,captureSelection:count === 0};
    }
    return result;
  };

  host.syncEquationMacros = function syncEquationMacros(mathfield) {
    const root = mathfield?._mathfield?.model?.root;
    if (!root) return {changed:0,macros:0};
    let changed = 0, macros = 0;
    const visited = new Set();
    function commit(atom) {
      if (!atom || visited.has(atom)) return;
      visited.add(atom);
      for (const child of directChildren(atom)) commit(child);
      if (marker(atom)) {
        // This also protects serialization if editing promotes a marked body
        // outside its original macro. No htmlData reaches native conversion.
        if (!atom.equationMarkerSerializer) {
          Object.defineProperty(atom,'equationMarkerSerializer',{value:true});
          atom._serialize = function(options) { return this.bodyToLatex(options || {}); };
          atom.isDirty = true;
        }
      }
      const name = atom.type === 'macro' ? atom.command?.replace(/^\\/,'') : null, definition = definitions.get(name);
      if (!definition || definition.count === 0) return;
      macros++;
      const old = originalArguments(atom.macroArgs || '',definition.count), current = new Map();
      function collect(node) {
        const tag = marker(node);
        if (tag?.owner === name) {
          const value = withoutMarkers(node.bodyToLatex({expandMacro:false,skipPlaceholders:false}));
          const values = current.get(tag.index) || []; values.push(value); current.set(tag.index,values);
          // An argument may itself contain the same macro; its markers belong
          // to the inner instance, already committed in post-order.
          return;
        }
        for (const child of directChildren(node)) collect(child);
      }
      for (const child of directChildren(atom)) collect(child);
      const next = old.map((value,index) => {
        if (!definition.visible.has(index + 1)) return withoutMarkers(value);
        const values = current.get(index + 1) || [''];
        const edits = [...new Set(values.filter(v => v !== value))];
        if (edits.length > 1) throw Error(`Conflicting edits in repeated macro argument ${name}#${index + 1}`);
        return edits[0] ?? values[0];
      });
      const serialized = next.map(value => `{${value === '' ? '{}' : value}}`).join('');
      if (serialized !== atom.macroArgs) { atom.macroArgs = serialized; atom.isDirty = true; changed++; }
    }
    commit(root);
    return {changed,macros};
  };
})(typeof window === 'undefined' ? globalThis : window);
