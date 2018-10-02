require('@babel/register');
import test from 'ava';

import inlex from '../dist/index';
import prepareCleanup from '../util/cleanup';
import * as domUtil from '../util/dom-util';

let doCleanup;

test.beforeEach('preparing for post-test cleanup...', () => {
  doCleanup = prepareCleanup();
});

test.afterEach('cleaning up test files...', () => {
  doCleanup();
});

test('output should not have inline styles', t => {
  const runOptions = {
    src: ['tests/example.jsp'],
    output: 'tests/tests.css',
    'no-replace': 'modified',
  };

  inlex(runOptions);

  const cleanedDom = domUtil.getDOMFromFile('tests/example.modified.jsp');
  console.log('is this even running');
  debugger;
  const numStyleAttrs = domUtil.testForAttr(cleanedDom, 'style').length;
  const numStyleTags = domUtil.testForTag(cleanedDom, 'style').length;

  t.is(numStyleAttrs, 0, 'Style attributes found.');
  t.is(numStyleTags, 0, 'Style tags found.');
});