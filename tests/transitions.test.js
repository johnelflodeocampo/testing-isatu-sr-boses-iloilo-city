const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTransitions({
  href = 'https://boses.example/',
  incomingTarget = null,
} = {}) {
  const classes = new Set(['public-page']);
  const rootClasses = new Set();
  const windowListeners = {};
  const overlayListeners = {};
  const timeouts = new Map();
  const assignedLocations = [];
  let nextTimeoutId = 0;
  const overlay = {
    addEventListener(name, callback) {
      overlayListeners[name] = callback;
    },
    setAttribute() {},
  };
  const window = {
    matchMedia: () => ({ matches: false }),
    addEventListener(name, callback) {
      windowListeners[name] = callback;
    },
    setTimeout(callback) {
      const id = ++nextTimeoutId;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    location: {
      href,
      get origin() { return new URL(this.href).origin; },
      get pathname() { return new URL(this.href).pathname; },
      get search() { return new URL(this.href).search; },
      assign(destination) {
        assignedLocations.push(destination);
      },
    },
  };
  const document = {
    body: {
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
      },
      append() {},
    },
    documentElement: {
      classList: {
        add(name) { rootClasses.add(name); },
        remove(name) { rootClasses.delete(name); },
      },
    },
    createElement: () => overlay,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const storedValues = new Map();
  if (incomingTarget) storedValues.set('publicPageTransitionTarget', incomingTarget);
  const sessionStorage = {
    getItem(key) { return storedValues.get(key) ?? null; },
    removeItem(key) { storedValues.delete(key); },
    setItem(key, value) { storedValues.set(key, value); },
  };
  const source = [
    fs.readFileSync(
      path.join(__dirname, '..', 'public', 'assets', 'js', 'transition-boot.js'),
      'utf8',
    ),
    fs.readFileSync(
      path.join(__dirname, '..', 'public', 'assets', 'js', 'transitions.js'),
      'utf8',
    ),
  ].join('\n');
  vm.runInNewContext(source, {
    window,
    document,
    URL,
    performance: {
      getEntriesByType: () => [{ type: 'navigate' }],
    },
    sessionStorage,
    console,
  });

  return {
    assignedLocations,
    classes,
    overlayListeners,
    rootClasses,
    runTimeouts() {
      for (const [id, callback] of timeouts) {
        timeouts.delete(id);
        callback();
      }
    },
    window,
    windowListeners,
  };
}

test('public navigation proceeds if the cover animation never ends', () => {
  const page = loadTransitions();

  page.window.bosesNavigate('/resources');
  assert.ok(page.classes.has('is-leaving'));

  page.runTimeouts();

  assert.deepEqual(page.assignedLocations, ['https://boses.example/resources']);
});

test('incoming page becomes interactive if the reveal animation never ends', () => {
  const page = loadTransitions({
    href: 'https://boses.example/resources',
    incomingTarget: 'https://boses.example/resources',
  });

  page.windowListeners.pageshow();
  assert.ok(page.classes.has('is-entering'));

  page.runTimeouts();

  assert.ok(!page.classes.has('is-entering'));
});

test('incoming public page is covered before deferred transition code runs', () => {
  const classes = new Set();
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'assets', 'js', 'transition-boot.js'),
    'utf8',
  );
  vm.runInNewContext(source, {
    window: {
      location: { href: 'https://boses.example/resources' },
      matchMedia: () => ({ matches: false }),
      setTimeout() {},
    },
    document: {
      documentElement: {
        classList: {
          add(name) { classes.add(name); },
          remove(name) { classes.delete(name); },
        },
      },
    },
    performance: {
      getEntriesByType: () => [{ type: 'navigate' }],
    },
    sessionStorage: {
      getItem: () => 'https://boses.example/resources',
    },
    console,
  });

  assert.ok(classes.has('public-transition-pending'));
});
