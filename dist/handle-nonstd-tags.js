"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getTagMap = exports.waitForTagFileEdit = exports.buildNonStandardTagFile = exports.validHtmlTags = exports.handleNonStandardTags = void 0;

var _fs = _interopRequireDefault(require("fs"));

var _commandLine = require("./command-line");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const validHtmlTags = ['!--', '!DOCTYPE', 'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside', 'audio', 'b', 'base', 'basefont', 'bdo', 'big', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'datalist', 'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'frame', 'frameset', 'head', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'p', 'param', 'pre', 'progress', 'q', 's', 'samp', 'script', 'section', 'select', 'small', 'source', 'span', 'strike', 'strong', 'style', 'sub', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'u', 'ul', 'var', 'video', 'wbr'];
exports.validHtmlTags = validHtmlTags;
const foundTags = new Map();
const promptedTags = [];
const prompts = [];

const createClosingTag = (tagname, closingTagStr) => {
  return closingTagStr.replace(/\[name\]/, tagname);
};

const outputHelpPrompt = () => {
  console.log('Non-standard HTML tag(s) have been found.\n');
  console.log('In order to preserve potentially crucial serverside elements');
  console.log('your manual input is required. Please indicate the structure');
  console.log('of the tag like the following example:\n');
  console.log('<taglib:test></taglib:test>');
  console.log('would become:\n');
  console.log('</[name]>');
  console.log('[name] will be replaced with the tagname for the current tag (taglib:test)');
  console.log('Input is optional. If no input is entered the closing tag would not exist.\n');
};

const handleNonStandardTags = async function (tagname, filename, linenumber) {
  if (!foundTags.has(tagname) && _commandLine.options.log) {
    // newly encountered non-standard tag
    if (foundTags.size === 0) {
      _fs.default.appendFileSync('nonStdMap.log', '\n===========================================\n'); // first encounter example prompt


      outputHelpPrompt();
    } // pad for a maximum of 5 digit linenumbers (: + 5 digit line number = 6) 
    // more than 100k lines should theoretically be supported, but its unlikely and
    // will just result in slightly less pretty formatting when asking for input


    const locationPrompt = `${filename}:${linenumber}`.padEnd(filename.length + 6);
    const prompt = `${locationPrompt} | tag: <${tagname}`;
    let answer = await (0, _commandLine.waitForInput)(prompt);
    answer = createClosingTag(tagname, answer);

    if (_commandLine.options.log) {
      _fs.default.appendFileSync('nonStdMap.log', `${prompt} ${answer}\n`);
    }

    foundTags.set(tagname, createClosingTag(tagname, answer));
  }
};

exports.handleNonStandardTags = handleNonStandardTags;

const buildNonStandardTagFile = (tagname, filename, linenumber) => {
  const locationPrompt = `${filename}:${linenumber}`;
  const prompt = `${locationPrompt} | tag: <${tagname} ...> \n`;

  if (!promptedTags.includes(tagname)) {
    prompts.push(prompt);
    promptedTags.push(tagname);
  }
};

exports.buildNonStandardTagFile = buildNonStandardTagFile;

const waitForTagFileEdit = async function () {
  // modify the output to keep things in line  
  const maxLocationLength = Math.max(...prompts.map(prompt => {
    return prompt.match(/^(.*)\|/)[1].length;
  }));
  const maxTagLength = Math.max(...prompts.map(prompt => {
    return prompt.match(/\| tag:.*/)[0].length;
  }));
  prompts.forEach(prompt => {
    let location = prompt.match(/^.*?:\d+/)[0];
    let promptEnd = prompt.match(/\| tag:.*/)[0];
    const formattedPrompt = `${location.padEnd(maxLocationLength)}${promptEnd.padEnd(maxTagLength)} : \n`;

    _fs.default.appendFileSync('non-std-tags.txt', formattedPrompt);
  });
  console.log('A file named \'non-std-tags.txt\' has been created');
  console.log('in the directory you ran this script from. Please edit');
  console.log('each line according to how the closing tag should');
  console.log('be structured.\n');
  await (0, _commandLine.waitForInput)('Please press enter when done...');

  const lines = _fs.default.readFileSync('non-std-tags.txt', 'utf8').split('\n');

  lines.forEach(line => {
    if (line.length > 0) {
      const tagname = line.match(/<(.*?)\s*?\.\.\./)[1];
      const closingTag = line.match(/\s:\s*(.*)/)[1] || '';

      if (_commandLine.options.log) {
        _fs.default.appendFileSync('nonStdMap.log', `${line}${closingTag}\n`);
      }

      foundTags.set(tagname, createClosingTag(tagname, closingTag));
    }
  });

  _fs.default.unlinkSync('non-std-tags.txt');
};

exports.waitForTagFileEdit = waitForTagFileEdit;

const getTagMap = () => {
  return foundTags;
};

exports.getTagMap = getTagMap;