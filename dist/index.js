#!/usr/bin/env node
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _fs = _interopRequireDefault(require("fs"));

var _htmlparser = _interopRequireDefault(require("htmlparser"));

var _soupselectUpdate = require("soupselect-update");

var _uniqueNamesGenerator = _interopRequireDefault(require("unique-names-generator"));

var _sqwish = require("sqwish");

var _commandLine = require("./command-line");

var _htmlparser2html = _interopRequireDefault(require("./htmlparser2html"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// global hashmap to keep track of classes that have already been created
// this should reduce or eliminate any classes that would otherwise have duplicate properties
const styleMap = new Map();

const printStyleMap = () => {
  console.log('styleMap:');
  styleMap.forEach((v, k) => {
    console.log(` ${k} => ${v}`);
  });
}; // file loading


const getFileContents = filename => {
  return _fs.default.readFileSync(filename, 'utf8');
}; // create new filename for current file if no-replace flag is used


const createModifiedName = (filename, modifier) => {
  const splitFilename = filename.split('.');
  const splitLength = splitFilename.length;
  splitFilename.splice(splitLength - 1, 0, `${modifier}`);
  return splitFilename.join('.');
};

const minifyCss = str => {
  return (0, _sqwish.minify)(str);
}; // find tags with the undesirables


const getBadStyles = dom => {
  return (0, _soupselectUpdate.select)(dom, '[style]').concat((0, _soupselectUpdate.select)(dom, 'style'));
}; // takes cheerio's attr object for the inline style, and transforms it to its own class with css syntax


const prettifyCss = (selector, declaration) => {
  // filter out any empty strings. if last character in styleAttr is ; then it will have an empty string at the end of the array
  const properties = declaration.split(';').filter(property => property.length > 0);
  const numProperties = properties.length;
  const styleProperties = properties.map((property, i) => {
    // don't give newline to last property so there isn't an empty line at the end of the css class
    const newline = i === numProperties - 1 ? '' : '\n';
    return `  ${property};${newline}`;
  });
  const declarationString = styleProperties.join('');
  const classString = `${selector} {\n${declarationString}\n}\n\n`;
  return classString;
}; // find if there's a class with the same properties that we can use


const hasMatchingClass = styleAttr => {
  return styleMap.has(styleAttr);
};

const addStyleToMap = (minifiedCss, className) => {
  let key;
  let value;

  if (className !== undefined) {
    key = minifiedCss;
    value = className;
    styleMap.set(key, value);
  } // if there's no matching class, we should create one, put it in the hash map, and write to the css file
  else if (!hasMatchingClass(minifiedCss)) {
      const randomClass = _uniqueNamesGenerator.default.generate('-');

      key = minifiedCss; // remove whitespace from properties for format-agnostic duplicate checking

      value = randomClass;
      styleMap.set(key, value);
    }
};

const styleMapToCssFile = filename => {
  // key = styles (no whitespace) that belong to a class
  // value = the class name that contains the styles in its key
  styleMap.forEach((v, k) => {
    const cssString = prettifyCss(`.${v}`, k);

    _fs.default.appendFileSync(_commandLine.options.output, cssString);
  });
};

const addInlineStylesToStyleMap = dom => {
  dom.map(node => {
    if (node.attribs && node.attribs.style) {
      // find and handle inline style attributes
      const inlineStyle = node.attribs.style;
      addStyleToMap(minifyCss(inlineStyle));
    }
  });
};

const cleanNode = node => {
  if (node.attribs && node.attribs.style) {
    const minStyle = minifyCss(node.attribs.style);
    const replacementClass = styleMap.get(minStyle);

    if (!node.attribs.class) {
      node.attribs.class = replacementClass;
    } else {
      node.attribs.class = `${node.attribs.class} ${replacementClass}`;
    } // remove that nasty inline style


    node.attribs.style = undefined;
  }

  return node;
};

const replaceStyleAttrs = node => {
  if (!node.children) {
    // we've hit a leaf, return the cleaned leaf
    return cleanNode(node);
  }

  cleanNode(node);
  return node.children.map(replaceStyleAttrs);
};

const cleanHtmlTags = dom => {
  // filter out style tags first
  dom = dom.filter(node => {
    return node.name !== 'style';
  }); // then map to replace inline style attrs with classes

  dom.map(replaceStyleAttrs);
};

const removeStyleTags = (node, parent) => {
  if (node.name === 'style') {
    // take style tag innerText and just move it straight to the css file
    let styles = node.children[0].data; // we'll have to parse the css to get the properties out of it and check to see if we can
    // match any inline styles to currently existing classes
    // each match will have 3 capture groups.
    // 0th is the full match
    // 1st being the selector
    // 2nd is the properties contained within that rule

    const cssRegex = /(?:([^\{\}]*))(?:{(.*?\s*)})*/gi;
    const matches = []; // find all matches of regex in the style tag's innerText

    styles = minifyCss(styles);
    let match = cssRegex.exec(styles); // if the full match is an empty string we're also done

    while (match !== null && match[0] !== '') {
      matches.push(match);
      match = cssRegex.exec(styles);
    }

    let cssArr = matches.map(match => {
      return prettifyCss(match[1], match[2]);
    });
    const cssOutput = cssArr.join('');

    _fs.default.appendFileSync(_commandLine.options.output, cssOutput);

    return undefined; // remove self from DOM
  } else {
    return node; // otherwise no touchy
  }
};

const outputModifiedSrcFile = (dom, htmlOutput) => {
  // html.configure({ disableAttribEscape: true });
  const rawHtmlOutput = (0, _htmlparser2html.default)(dom, removeStyleTags);

  _fs.default.writeFileSync(htmlOutput, rawHtmlOutput);
};

const parseHandler = new _htmlparser.default.DefaultHandler((err, dom) => {
  if (err) {
    console.error(err);
    process.exit(1); // oh no something bad happened.
  } else {
    return filename => {
      cleanSrcFile(dom, filename);
    };
  }
});

const cleanSrcFile = (dom, filename) => {
  const badStyles = getBadStyles(dom);
  addInlineStylesToStyleMap(badStyles);
  const htmlOutput = _commandLine.options['no-replace'] === undefined ? currentFile : createModifiedName(currentFile, _commandLine.options['no-replace']);
  styleMapToCssFile(_commandLine.options.output);
  cleanHtmlTags(dom);
  outputModifiedSrcFile(dom, htmlOutput);
}; // do the stuff, but on a directory


const runDir = (runOptions, workingDir) => {
  let dir = workingDir === undefined ? runOptions.directory : workingDir;

  const entities = _fs.default.readdirSync(runOptions.directory);

  const files = [];
  const dirs = [];
  entities.forEach(entity => {
    if (_fs.default.lstatSync(`${dir}/${entity}`).isFile()) {
      files.push(entity);
    } else if (_fs.default.lstatSync(`${dir}/${entity}`).isDirectory()) {
      dirs.push(entity);
    }
  });
  const isLeafDir = dirs.length === 0;
  files.forEach(file => {
    let filename = `${dir}/${file}`;
    let fileContents = getFileContents(filename);
    let parser = new _htmlparser.default.Parser(parseHandler);
    parser.parseComplete(fileContents)(filename);
  });

  if (runOptions.recursive && !isLeafDir) {
    dirs.forEach(d => runDir(runOptions, `${dir}/${d}`));
  } else {
    return;
  }
}; // do the stuff


const run = runOptions => {
  // use options instead of runOptions if being run through
  // cli as opposed to via another script
  if (!runOptions) {
    runOptions = _commandLine.options;
  }

  if (_commandLine.options.help || !_commandLine.options.src && !_commandLine.options.directory) {
    // print help message if not used properly
    console.log(_commandLine.usage);
  } else if (_commandLine.options.directory) {
    runDir(runOptions);
  } else {
    // didn't use directory mode
    for (let i = 0; i < _commandLine.options.src.length; i++) {
      let currentFile = _commandLine.options.src[i];
      let fileContents = getFileContents(currentFile);
      let parser = new _htmlparser.default.Parser(parseHandler);
      parser.parseComplete(fileContents)(currentFile);
    }
  }
}; // start up the script when run from command line


run();
var _default = run;
exports.default = _default;