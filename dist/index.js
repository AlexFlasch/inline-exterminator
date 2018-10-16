#!/usr/bin/env node
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _fs = _interopRequireDefault(require("fs"));

var _htmlparser = _interopRequireDefault(require("htmlparser2"));

var _soupselectUpdate = require("soupselect-update");

var _uniqueNamesGenerator = _interopRequireDefault(require("unique-names-generator"));

var _sqwish = require("sqwish");

var _commandLine = require("./command-line");

var _htmlparser2html = _interopRequireDefault(require("./htmlparser2html"));

var _handleNonstdTags = require("./handle-nonstd-tags");

var _deprecatedHtml = require("./deprecated-html");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

let options; // global hashmap to keep track of classes that have already been created
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
}; // takes a selector and the declarations in that selector, and transforms it
// back to css in a human-readable format


const prettifyCss = (selector, declarations) => {
  // filter out any empty strings.
  // if last character in declarations is ; then it will have an empty string at the end of the array
  const properties = declarations.split(';').filter(property => property.length > 0);
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
    value = {
      className: className,
      isUsed: false
    };
    styleMap.set(key, value);
  } // if there's no matching class, we should create one, put it in the hash map, and write to the css file
  else if (!hasMatchingClass(minifiedCss)) {
      const randomClass = _uniqueNamesGenerator.default.generate('-');

      key = minifiedCss; // remove whitespace from properties for format-agnostic duplicate checking

      value = {
        className: randomClass,
        isUsed: false
      };
      styleMap.set(key, value);
    }
};

const styleMapToCssFile = filename => {
  // key = styles properties (minified) that belong to a class
  // value = an object containing the class name that contains the styles in its key as well as 
  //         a bool tracking whether this class has already been output to the css file
  styleMap.forEach((v, k) => {
    if (!v.isUsed) {
      const cssString = prettifyCss(`.${v.className}`, k);

      _fs.default.appendFileSync(_commandLine.options.output, cssString);

      const usedValue = {
        className: v.className,
        isUsed: true
      };
      styleMap.set(k, usedValue);
    }
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

let deprecationClasses = [];

const addClassToNode = (node, className) => {
  if (node.attribs === undefined) {
    node.attribs = {
      class: className
    };
  } else {
    if (node.attribs.class === undefined) {
      node.attribs.class = className;
    } else {
      if (node.attribs.class.indexOf(className) === -1) {
        node.attribs.class = `${node.attribs.class} ${className}`;
      }
    }
  }

  return node;
};

const updateDeprecatedTag = node => {
  switch (node.name) {
    case 'center':
      node.name = 'div';
      addClassToNode(node, 'centered');
      deprecationClasses.push({
        className: 'centered',
        declaration: 'text-align:center;'
      });
      break;

    case 'basefont':
    case 'font':
      let fontColor, fontFace, fontSize, declaration;

      const fontClass = _uniqueNamesGenerator.default.generate('-');

      if (node.attribs) {
        fontColor = node.attribs.color || '';
        fontFace = node.attribs.face || '';
        fontSize = (0, _deprecatedHtml.fontTagSizeToCss)(node.attribs.size);
        declaration = `color:${fontColor};font-family:${fontFace};font-size:${fontSize}`;
        deprecationClasses.push({
          className: fontClass,
          declaration: declaration
        });
      }

      if (node.children && node.children.length > 0) {
        const updatedChildren = node.children.map(child => addClassToNode(child, fontClass)); // find the font tag's index in the children array

        const fontIndex = node.parent.children.findIndex(child => Object.is(node, child)); // replace the font tag with all of its children

        node.parent.children.splice(fontIndex, 1, ...updatedChildren);
      }

      break;
  }
};

const updateDeprecatedAttr = (node, attr) => {
  let attrClass;
  let declaration = '';
  let selectorExtra = '';
  let hasSelectorExtra = false;
  let value, unit;

  switch (attr) {
    case 'align':
      attrClass = `align-${node.attribs[attr]}`;
      declaration = `text-align:${node.attribs[attr]};`;
      break;

    case 'bgcolor':
      attrClass = _uniqueNamesGenerator.default.generate('-');
      declaration = `background-color:${node.attribs[attr]};`;
      break;

    case 'border':
      const borderMatch = node.attribs[attr].match(/^(\d*|\d*\.\d*)(\w*)$/);
      value = borderMatch[1] || '';
      unit = borderMatch[2] || '';
      unit = unit === '' ? 'px' : unit;
      attrClass = `border-width-${value}${unit}`;
      declaration = `border-width:${value}${unit};`;
      break;

    case 'cellpadding':
      const paddingMatch = node.attribs[attr].match(/^(\d*|\d*\.\d*)(\w*)$/);
      value = paddingMatch[1] || '';
      unit = paddingMatch[2] || '';
      unit = unit === '' ? 'px' : unit;
      attrClass = `padding-${value}${unit}`;
      declaration = `border-collapse:collapse;padding:${value}${unit};`;
      selectorExtra = ['th', 'td'];
      hasSelectorExtra = true;
      break;

    case 'cellspacing':
      const spacingMatch = node.attribs[attr].match(/^(\d*|\d*\.\d*)(\w*)$/);
      value = spacingMatch[1] || '';
      unit = spacingMatch[2] || '';
      unit = unit === '' ? 'px' : unit;
      attrClass = `border-spacing-${value}${unit}`;
      declaration = `border-collapse:collapse;border-spacing:${value}${unit};`;
      selectorExtra = ['th', 'td'];
      hasSelectorExtra = true;
      break;

    case 'width':
      const match = node.attribs[attr].match(/^(\d*|\d*\.\d*)(\w*)$/);
      value = match[1] || '';
      unit = match[2] || '';
      unit = unit === '' ? 'px' : unit;
      attrClass = `width-${value}${unit}`;
      declaration = `width:${value}${unit};`;
      break;

    case 'valign':
      attrClass = `vert-align-${node.attribs[attr]}`;
      declaration = `vertical-align:${node.attribs[attr]};`;
      break;

    default:
      return;
  }

  if (!styleMap.has(declaration) && !hasSelectorExtra) {
    addStyleToMap(declaration, attrClass);
  } else if (hasSelectorExtra) {
    const cssSelector = selectorExtra.map(extra => {
      return `.${attrClass} ${extra}`;
    }).join(',\n');

    _fs.default.appendFileSync(_commandLine.options.output, prettifyCss(cssSelector, declaration));
  } else {
    attrClass = styleMap.get(declaration).className;
  }

  node.attribs[attr] = undefined; // delete deprecated attr

  addClassToNode(node, attrClass);
};

const handleDeprecations = node => {
  if ((0, _deprecatedHtml.isTagDeprecated)(node)) {
    updateDeprecatedTag(node);
  }

  const deprecatedAttrs = (0, _deprecatedHtml.getDeprecatedAttrsForNode)(node);

  if (deprecatedAttrs.length > 0) {
    deprecatedAttrs.forEach(attr => updateDeprecatedAttr(node, attr));
  }

  deprecationClasses.forEach(classObj => addStyleToMap((0, _sqwish.minify)(classObj.declaration), classObj.className));
};

const cleanNode = node => {
  if (node.attribs && node.attribs.style) {
    const minStyle = minifyCss(node.attribs.style);
    const replacementClass = styleMap.get(minStyle).className;

    if (!node.attribs.class) {
      node.attribs.class = replacementClass;
    } else {
      node.attribs.class = `${node.attribs.class} ${replacementClass}`;
    } // remove that nasty inline style


    node.attribs.style = undefined;
  }

  handleDeprecations(node);
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

    _fs.default.appendFileSync(options.output, cssOutput);

    return undefined; // remove self from DOM
  } else {
    return node; // otherwise no touchy
  }
};

const nonStandardClosingTagHandler = nonStdMap => {
  return node => {
    return nonStdMap.get(node.name);
  };
};

const outputModifiedSrcFile = (dom, htmlOutput) => {
  const nonStdMap = (0, _handleNonstdTags.getTagMap)();
  const rawHtmlOutput = (0, _htmlparser2html.default)(dom, removeStyleTags, nonStandardClosingTagHandler(nonStdMap));

  _fs.default.writeFileSync(htmlOutput, rawHtmlOutput);
};

const createParseHandler = filename => {
  return new _htmlparser.default.DefaultHandler((err, dom) => {
    if (err) {
      console.error(err);
      process.exit(1); // oh no something bad happened
    } else {
      cleanSrcFile(dom, filename);
    }
  }, {
    decodeEntities: true,
    lowerCaseTags: false
  });
};

let invalidTags = [];

const createPreParseHandler = filename => {
  return {
    callbacks: {
      onopentag: name => {
        if (!_handleNonstdTags.validHtmlTags.includes(name)) {
          invalidTags.push({
            name,
            filename
          });
        }
      },
      onreset: () => {
        linenumber = 1;
        invalidTags = [];
      },
      onerror: err => {
        if (err) {
          console.error(err);
          process.exit(1); // oh no something bad happened.
        }
      }
    },
    options: {
      decodeEntities: true,
      lowerCaseTags: false
    }
  };
};

const getFirstTagLineNumber = (filename, name) => {
  const fileContents = getFileContents(filename);
  const tagRegex = new RegExp(`<${name}\\s`, 'i');
  const firstMatch = tagRegex.exec(fileContents);

  if (firstMatch === null) {
    _fs.default.appendFileSync('nonStdMap.log', `Failed to find ${name} in ${filename}\n`);

    return '??';
  } else {
    const index = firstMatch.index;
    const fileBeforeMatch = fileContents.substr(0, index);
    const newLineRegex = /\n/g;
    let linenumber = 1;
    let match = newLineRegex.exec(fileBeforeMatch);

    while (match !== null && match.index < index) {
      linenumber++;
      match = newLineRegex.exec(fileBeforeMatch);
    }

    return linenumber;
  }
};

const getInvalidTagInput = async function (isInteractive) {
  for (const tag of invalidTags) {
    const name = tag.name;
    const filename = tag.filename;
    const linenumber = getFirstTagLineNumber(filename, name);

    if (isInteractive) {
      await (0, _handleNonstdTags.handleNonStandardTags)(name, filename, linenumber);
    } else {
      (0, _handleNonstdTags.buildNonStandardTagFile)(name, filename, linenumber);
    }
  }
};

const cleanSrcFile = (dom, filename) => {
  const badStyles = getBadStyles(dom);
  addInlineStylesToStyleMap(badStyles);
<<<<<<< HEAD
  const htmlOutput = options['no-replace'] === undefined ? filename : createModifiedName(filename, options['no-replace']);
  styleMapToCssFile(options.output);
=======
  const htmlOutput = _commandLine.options['no-replace'] === undefined ? filename : createModifiedName(filename, _commandLine.options['no-replace']);
>>>>>>> master
  cleanHtmlTags(dom);
  styleMapToCssFile(_commandLine.options.output);
  outputModifiedSrcFile(dom, htmlOutput);
}; // do the stuff, but on a directory


const preParseDir = async function (runOptions, workingDir) {
  let dir = workingDir === undefined ? runOptions.directory : workingDir;

  let entities = _fs.default.readdirSync(dir);

  let files = [];
  let dirs = [];
  entities.forEach(entity => {
    if (_fs.default.lstatSync(`${dir}/${entity}`).isFile()) {
      files.push(entity);
    } else if (_fs.default.lstatSync(`${dir}/${entity}`).isDirectory()) {
      dirs.push(entity);
    }
  });
  files = filterFiletypes(files);
  const isLeafDir = dirs.length === 0;

  for (const file of files) {
    let filename = `${dir}/${file}`;
    let fileContents = getFileContents(filename);
    const parserOptions = createPreParseHandler(filename);
    let preParser = new _htmlparser.default.Parser(parserOptions.callbacks, parserOptions.options);
    preParser.write(fileContents);
    preParser.end();
    await getInvalidTagInput(runOptions.interactive);
  }

  ;

  if (runOptions.recursive && !isLeafDir) {
    for (const d of dirs) {
      await preParseDir(runOptions, `${dir}/${d}`);
    }
  } else {
    return;
  }
};

const runDir = async function (runOptions, workingDir) {
  let dir = workingDir === undefined ? runOptions.directory : workingDir;

  let entities = _fs.default.readdirSync(dir);

  let files = [];
  let dirs = [];
  entities.forEach(entity => {
    if (_fs.default.lstatSync(`${dir}/${entity}`).isFile()) {
      files.push(entity);
    } else if (_fs.default.lstatSync(`${dir}/${entity}`).isDirectory()) {
      dirs.push(entity);
    }
  });
  files = filterFiletypes(files);
  const isLeafDir = dirs.length === 0;

  for (const file of files) {
    let filename = `${dir}/${file}`;
    let fileContents = getFileContents(filename);
    let parser = new _htmlparser.default.Parser(createParseHandler(filename), {
      decodeEntities: true,
      lowerCaseTags: false
    });
    parser.parseComplete(fileContents);
  }

  ;

  if (runOptions.recursive && !isLeafDir) {
    for (const d of dirs) {
      await runDir(runOptions, `${dir}/${d}`);
    }
  } else {
    return;
  }
};

const filterFiletypes = filenames => {
  if (options.filetype) {
    const filetypeRegexes = options.filetype.map(filetype => {
      return new RegExp(` ${filetype}$`, 'i');
    });
    filenames = filenames.filter(filename => {
      return filetypeRegexes.map(regex => {
        return regex.test(filename);
      }).includes(true);
    });
  }

  return filenames;
}; // do the stuff


const run = async function (runOptions) {
  // use options instead of runOptions if being run through
  // cli as opposed to via another script
<<<<<<< HEAD
  options = runOptions;
=======
  if (runOptions) {
    _commandLine.options = (runOptions, function () {
      throw new Error('"' + "options" + '" is read-only.');
    }());
  }
>>>>>>> master

  if (runOptions.help || !runOptions.src && !runOptions.directory) {
    // print help message if not used properly
    console.log(_commandLine.usage);
<<<<<<< HEAD
  } else if (runOptions.directory) {
    runDir(runOptions);
=======
  } else if (_commandLine.options.directory) {
    await preParseDir(_commandLine.options);
    await (0, _handleNonstdTags.waitForTagFileEdit)();
    await runDir(_commandLine.options);
>>>>>>> master
  } else {
    // didn't use directory mode
    let filenames = options.src;
    filenames = filterFiletypes(filenames);

<<<<<<< HEAD
    for (let i = 0; i < runOptions.src.length; i++) {
      let currentFile = runOptions.src[i];
=======
    for (let i = 0; i < filenames.length; i++) {
      let currentFile = filenames[i];
>>>>>>> master
      let fileContents = getFileContents(currentFile);
      const parserOptions = createPreParseHandler(currentFile);
      let preParser = new _htmlparser.default.Parser(parserOptions.callbacks, parserOptions.options);
      preParser.write(fileContents);
      preParser.end();
      await getInvalidTagInput(_commandLine.options.interactive);
    }

    if (!_commandLine.options.interactive) {
      await (0, _handleNonstdTags.waitForTagFileEdit)();

      for (let i = 0; i < filenames.length; i++) {
        let currentFile = filenames[i];
        let fileContents = getFileContents(currentFile);
        let parser = new _htmlparser.default.Parser(createParseHandler(currentFile), {
          decodeEntities: true,
          lowerCaseTags: false
        });
        parser.parseComplete(fileContents);
      }
    }
  }
}; // start up the script when run from command line
// otherwise don't run the script, wait for someone
// who imported it to start it up.


if (require.main === module) {
  run(_commandLine.cliOptions);
}

var _default = run;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC5qcyJdLCJuYW1lcyI6WyJvcHRpb25zIiwic3R5bGVNYXAiLCJNYXAiLCJwcmludFN0eWxlTWFwIiwiY29uc29sZSIsImxvZyIsImZvckVhY2giLCJ2IiwiayIsImdldEZpbGVDb250ZW50cyIsImZpbGVuYW1lIiwiZnMiLCJyZWFkRmlsZVN5bmMiLCJjcmVhdGVNb2RpZmllZE5hbWUiLCJtb2RpZmllciIsInNwbGl0RmlsZW5hbWUiLCJzcGxpdCIsInNwbGl0TGVuZ3RoIiwibGVuZ3RoIiwic3BsaWNlIiwiam9pbiIsIm1pbmlmeUNzcyIsInN0ciIsImdldEJhZFN0eWxlcyIsImRvbSIsImNvbmNhdCIsInByZXR0aWZ5Q3NzIiwic2VsZWN0b3IiLCJkZWNsYXJhdGlvbnMiLCJwcm9wZXJ0aWVzIiwiZmlsdGVyIiwicHJvcGVydHkiLCJudW1Qcm9wZXJ0aWVzIiwic3R5bGVQcm9wZXJ0aWVzIiwibWFwIiwiaSIsIm5ld2xpbmUiLCJkZWNsYXJhdGlvblN0cmluZyIsImNsYXNzU3RyaW5nIiwiaGFzTWF0Y2hpbmdDbGFzcyIsInN0eWxlQXR0ciIsImhhcyIsImFkZFN0eWxlVG9NYXAiLCJtaW5pZmllZENzcyIsImNsYXNzTmFtZSIsImtleSIsInZhbHVlIiwidW5kZWZpbmVkIiwic2V0IiwicmFuZG9tQ2xhc3MiLCJuYW1lR2VuZXJhdG9yIiwiZ2VuZXJhdGUiLCJzdHlsZU1hcFRvQ3NzRmlsZSIsImNzc1N0cmluZyIsImFwcGVuZEZpbGVTeW5jIiwiYWRkSW5saW5lU3R5bGVzVG9TdHlsZU1hcCIsIm5vZGUiLCJhdHRyaWJzIiwic3R5bGUiLCJpbmxpbmVTdHlsZSIsImNsZWFuTm9kZSIsIm1pblN0eWxlIiwicmVwbGFjZW1lbnRDbGFzcyIsImdldCIsImNsYXNzIiwicmVwbGFjZVN0eWxlQXR0cnMiLCJjaGlsZHJlbiIsImNsZWFuSHRtbFRhZ3MiLCJuYW1lIiwicmVtb3ZlU3R5bGVUYWdzIiwicGFyZW50Iiwic3R5bGVzIiwiZGF0YSIsImNzc1JlZ2V4IiwibWF0Y2hlcyIsIm1hdGNoIiwiZXhlYyIsInB1c2giLCJjc3NBcnIiLCJjc3NPdXRwdXQiLCJvdXRwdXQiLCJvdXRwdXRNb2RpZmllZFNyY0ZpbGUiLCJodG1sT3V0cHV0IiwicmF3SHRtbE91dHB1dCIsIndyaXRlRmlsZVN5bmMiLCJjcmVhdGVQYXJzZUhhbmRsZXIiLCJodG1scGFyc2VyIiwiRGVmYXVsdEhhbmRsZXIiLCJlcnIiLCJlcnJvciIsInByb2Nlc3MiLCJleGl0IiwiY2xlYW5TcmNGaWxlIiwiYmFkU3R5bGVzIiwicnVuRGlyIiwicnVuT3B0aW9ucyIsIndvcmtpbmdEaXIiLCJkaXIiLCJkaXJlY3RvcnkiLCJlbnRpdGllcyIsInJlYWRkaXJTeW5jIiwiZmlsZXMiLCJkaXJzIiwiZW50aXR5IiwibHN0YXRTeW5jIiwiaXNGaWxlIiwiaXNEaXJlY3RvcnkiLCJmaWx0ZXJGaWxldHlwZXMiLCJpc0xlYWZEaXIiLCJmaWxlIiwiZmlsZUNvbnRlbnRzIiwicGFyc2VyIiwiUGFyc2VyIiwicGFyc2VDb21wbGV0ZSIsInJlY3Vyc2l2ZSIsImQiLCJmaWxlbmFtZXMiLCJmaWxldHlwZSIsImZpbGV0eXBlUmVnZXhlcyIsIlJlZ0V4cCIsInJlZ2V4IiwidGVzdCIsImluY2x1ZGVzIiwicnVuIiwiaGVscCIsInNyYyIsInVzYWdlIiwiY3VycmVudEZpbGUiLCJyZXF1aXJlIiwibWFpbiIsIm1vZHVsZSIsImNsaU9wdGlvbnMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFFQTs7QUFDQTs7OztBQUVBLElBQUlBLE9BQUosQyxDQUVBO0FBQ0E7O0FBQ0EsTUFBTUMsUUFBUSxHQUFHLElBQUlDLEdBQUosRUFBakI7O0FBRUEsTUFBTUMsYUFBYSxHQUFHLE1BQU07QUFDMUJDLEVBQUFBLE9BQU8sQ0FBQ0MsR0FBUixDQUFZLFdBQVo7QUFDQUosRUFBQUEsUUFBUSxDQUFDSyxPQUFULENBQWlCLENBQUNDLENBQUQsRUFBSUMsQ0FB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NEQsVUFBVSxDQUFDOEIsR0FBWCxDQUFlM0csTUFBbkMsRUFBMkNpQixDQUFDLEVBQTVDLEVBQWdEO0FBQzlDLFVBQUk0RixXQUFXLEdBQUdoQyxVQUFVLENBQUM4QixHQUFYLENBQWUxRixDQUFmLENBQWxCO0FBQ0EsVUFBSTJFLFlBQVksR0FBR3JHLGVBQWUsQ0FBQ3NILFdBQUQsQ0FBbEM7QUFFQSxVQUFJaEIsTUFBTSxHQUFHLElBQUl6QixvQkFBVzBCLE1BQWYsQ0FBc0IzQixrQkFBa0IsQ0FBQzBDLFdBQUQsQ0FBeEMsQ0FBYjtBQUNBaEIsTUFBQUEsTUFBTSxDQUFDRSxhQUFQLENBQXFCSCxZQUFyQjtBQUNEO0FBQ0Y7QUFDRixDQXhCRCxDLENBMEJBO0FBQ0E7QUFDQTs7O0FBQ0EsSUFBSWtCLE9BQU8sQ0FBQ0MsSUFBUixLQUFpQkMsTUFBckIsRUFBNkI7QUFDM0JQLEVBQUFBLEdBQUcsQ0FBQ1EsdUJBQUQsQ0FBSDtBQUNEOztlQUVjUixHIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGZzIGZyb20gJ2ZzJztcbmltcG9ydCBodG1scGFyc2VyIGZyb20gJ2h0bWxwYXJzZXInO1xuaW1wb3J0IHsgc2VsZWN0IGFzICQgfSBmcm9tICdzb3Vwc2VsZWN0LXVwZGF0ZSc7XG5pbXBvcnQgbmFtZUdlbmVyYXRvciBmcm9tICd1bmlxdWUtbmFtZXMtZ2VuZXJhdG9yJztcbmltcG9ydCB7IG1pbmlmeSB9IGZyb20gJ3Nxd2lzaCc7XG5cbmltcG9ydCB7IGNsaU9wdGlvbnMsIHVzYWdlIH0gZnJvbSAnLi9jb21tYW5kLWxpbmUnO1xuaW1wb3J0IGh0bWwgZnJvbSAnLi9odG1scGFyc2VyMmh0bWwnO1xuXG5sZXQgb3B0aW9ucztcblxuLy8gZ2xvYmFsIGhhc2htYXAgdG8ga2VlcCB0cmFjayBvZiBjbGFzc2VzIHRoYXQgaGF2ZSBhbHJlYWR5IGJlZW4gY3JlYXRlZFxuLy8gdGhpcyBzaG91bGQgcmVkdWNlIG9yIGVsaW1pbmF0ZSBhbnkgY2xhc3NlcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBoYXZlIGR1cGxpY2F0ZSBwcm9wZXJ0aWVzXG5jb25zdCBzdHlsZU1hcCA9IG5ldyBNYXAoKTtcblxuY29uc3QgcHJpbnRTdHlsZU1hcCA9ICgpID0+IHtcbiAgY29uc29sZS5sb2coJ3N0eWxlTWFwOicpXG4gIHN0eWxlTWFwLmZvckVhY2goKHYsIGspID0+IHtcbiAgICBjb25zb2xlLmxvZyhgICR7a30gPT4gJHt2fWApO1xuICB9KTtcbn1cblxuLy8gZmlsZSBsb2FkaW5nXG5jb25zdCBnZXRGaWxlQ29udGVudHMgPSAoZmlsZW5hbWUpID0+IHtcbiAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhmaWxlbmFtZSwgJ3V0ZjgnKTtcbn1cblxuLy8gY3JlYXRlIG5ldyBmaWxlbmFtZSBmb3IgY3VycmVudCBmaWxlIGlmIG5vLXJlcGxhY2UgZmxhZyBpcyB1c2VkXG5jb25zdCBjcmVhdGVNb2RpZmllZE5hbWUgPSAoZmlsZW5hbWUsIG1vZGlmaWVyKSA9PiB7XG4gIGNvbnN0IHNwbGl0RmlsZW5hbWUgPSBmaWxlbmFtZS5zcGxpdCgnLicpO1xuICBjb25zdCBzcGxpdExlbmd0aCA9IHNwbGl0RmlsZW5hbWUubGVuZ3RoO1xuXG4gIHNwbGl0RmlsZW5hbWUuc3BsaWNlKHNwbGl0TGVuZ3RoIC0gMSwgMCwgYCR7bW9kaWZpZXJ9YCk7XG4gIHJldHVybiBzcGxpdEZpbGVuYW1lLmpvaW4oJy4nKTtcbn1cblxuY29uc3QgbWluaWZ5Q3NzID0gKHN0cikgPT4ge1xuICByZXR1cm4gbWluaWZ5KHN0cik7XG59XG5cbi8vIGZpbmQgdGFncyB3aXRoIHRoZSB1bmRlc2lyYWJsZXNcbmNvbnN0IGdldEJhZFN0eWxlcyA9IChkb20pID0+IHtcbiAgcmV0dXJuICQoZG9tLCAnW3N0eWxlXScpLmNvbmNhdCgkKGRvbSwgJ3N0eWxlJykpO1xufVxuXG4vLyB0YWtlcyBhIHNlbGVjdG9yIGFuZCB0aGUgZGVjbGFyYXRpb25zIGluIHRoYXQgc2VsZWN0b3IsIGFuZCB0cmFuc2Zvcm1zIGl0XG4vLyBiYWNrIHRvIGNzcyBpbiBhIGh1bWFuLXJlYWRhYmxlIGZvcm1hdFxuY29uc3QgcHJldHRpZnlDc3MgPSAoc2VsZWN0b3IsIGRlY2xhcmF0aW9ucykgPT4ge1xuICAvLyBmaWx0ZXIgb3V0IGFueSBlbXB0eSBzdHJpbmdzLlxuICAvLyBpZiBsYXN0IGNoYXJhY3RlciBpbiBkZWNsYXJhdGlvbnMgaXMgOyB0aGVuIGl0IHdpbGwgaGF2ZSBhbiBlbXB0eSBzdHJpbmcgYXQgdGhlIGVuZCBvZiB0aGUgYXJyYXlcbiAgY29uc3QgcHJvcGVydGllcyA9IGRlY2xhcmF0aW9ucy5zcGxpdCgnOycpLmZpbHRlcihwcm9wZXJ0eSA9PiBwcm9wZXJ0eS5sZW5ndGggPiAwKTtcbiAgY29uc3QgbnVtUHJvcGVydGllcyA9IHByb3BlcnRpZXMubGVuZ3RoO1xuICBjb25zdCBzdHlsZVByb3BlcnRpZXMgPSBwcm9wZXJ0aWVzLm1hcCgocHJvcGVydHksIGkpID0+IHtcbiAgICAvLyBkb24ndCBnaXZlIG5ld2xpbmUgdG8gbGFzdCBwcm9wZXJ0eSBzbyB0aGVyZSBpc24ndCBhbiBlbXB0eSBsaW5lIGF0IHRoZSBlbmQgb2YgdGhlIGNzcyBjbGFzc1xuICAgIGNvbnN0IG5ld2xpbmUgPSBpID09PSBudW1Qcm9wZXJ0aWVzIC0gMSA/ICcnIDogJ1xcbic7XG5cbiAgICByZXR1cm4gYCAgJHtwcm9wZXJ0eX07JHtuZXdsaW5lfWA7XG4gIH0pO1xuICBjb25zdCBkZWNsYXJhdGlvblN0cmluZyA9IHN0eWxlUHJvcGVydGllcy5qb2luKCcnKTtcblxuICBjb25zdCBjbGFzc1N0cmluZyA9IGAke3NlbGVjdG9yfSB7XFxuJHtkZWNsYXJhdGlvblN0cmluZ31cXG59XFxuXFxuYDtcblxuICByZXR1cm4gY2xhc3NTdHJpbmc7XG59O1xuXG4vLyBmaW5kIGlmIHRoZXJlJ3MgYSBjbGFzcyB3aXRoIHRoZSBzYW1lIHByb3BlcnRpZXMgdGhhdCB3ZSBjYW4gdXNlXG5jb25zdCBoYXNNYXRjaGluZ0NsYXNzID0gKHN0eWxlQXR0cikgPT4ge1xuICByZXR1cm4gc3R5bGVNYXAuaGFzKHN0eWxlQXR0cik7XG59XG5cbmNvbnN0IGFkZFN0eWxlVG9NYXAgPSAobWluaWZpZWRDc3MsIGNsYXNzTmFtZSkgPT4ge1xuICBsZXQga2V5O1xuICBsZXQgdmFsdWU7XG4gIFxuICBpZiAoY2xhc3NOYW1lICE9PSB1bmRlZmluZWQpIHtcbiAgICBrZXkgPSBtaW5pZmllZENzcztcbiAgICB2YWx1ZSA9IGNsYXNzTmFtZTtcblxuICAgIHN0eWxlTWFwLnNldChrZXksIHZhbHVlKTtcbiAgfVxuICAvLyBpZiB0aGVyZSdzIG5vIG1hdGNoaW5nIGNsYXNzLCB3ZSBzaG91bGQgY3JlYXRlIG9uZSwgcHV0IGl0IGluIHRoZSBoYXNoIG1hcCwgYW5kIHdyaXRlIHRvIHRoZSBjc3MgZmlsZVxuICBlbHNlIGlmICghaGFzTWF0Y2hpbmdDbGFzcyhtaW5pZmllZENzcykpIHtcbiAgICBjb25zdCByYW5kb21DbGFzcyA9IG5hbWVHZW5lcmF0b3IuZ2VuZXJhdGUoJy0nKTtcbiAgICBrZXkgPSBtaW5pZmllZENzcztcbiAgICAvLyByZW1vdmUgd2hpdGVzcGFjZSBmcm9tIHByb3BlcnRpZXMgZm9yIGZvcm1hdC1hZ25vc3RpYyBkdXBsaWNhdGUgY2hlY2tpbmdcbiAgICB2YWx1ZSA9IHJhbmRvbUNsYXNzO1xuXG4gICAgc3R5bGVNYXAuc2V0KGtleSwgdmFsdWUpO1xuICB9XG59XG5cbmNvbnN0IHN0eWxlTWFwVG9Dc3NGaWxlID0gKGZpbGVuYW1lKSA9PiB7XG4gIC8vIGtleSA9IHN0eWxlcyAobm8gd2hpdGVzcGFjZSkgdGhhdCBiZWxvbmcgdG8gYSBjbGFzc1xuICAvLyB2YWx1ZSA9IHRoZSBjbGFzcyBuYW1lIHRoYXQgY29udGFpbnMgdGhlIHN0eWxlcyBpbiBpdHMga2V5XG4gIHN0eWxlTWFwLmZvckVhY2goKHYsIGspID0+IHtcbiAgICBjb25zdCBjc3NTdHJpbmcgPSBwcmV0dGlmeUNzcyhgLiR7dn1gLCBrKTtcbiAgICBmcy5hcHBlbmRGaWxlU3luYyhmaWxlbmFtZSwgY3NzU3RyaW5nKTtcbiAgfSk7XG5cbn1cblxuY29uc3QgYWRkSW5saW5lU3R5bGVzVG9TdHlsZU1hcCA9IChkb20pID0+IHtcbiAgZG9tLm1hcChub2RlID0+IHtcbiAgICBpZiAobm9kZS5hdHRyaWJzICYmIG5vZGUuYXR0cmlicy5zdHlsZSkge1xuICAgICAgLy8gZmluZCBhbmQgaGFuZGxlIGlubGluZSBzdHlsZSBhdHRyaWJ1dGVzXG4gICAgICBjb25zdCBpbmxpbmVTdHlsZSA9IG5vZGUuYXR0cmlicy5zdHlsZTtcbiAgICAgIGFkZFN0eWxlVG9NYXAobWluaWZ5Q3NzKGlubGluZVN0eWxlKSk7XG4gICAgfVxuICB9KTtcbn1cblxuY29uc3QgY2xlYW5Ob2RlID0gKG5vZGUpID0+IHtcbiAgaWYgKG5vZGUuYXR0cmlicyAmJiBub2RlLmF0dHJpYnMuc3R5bGUpIHtcbiAgICBjb25zdCBtaW5TdHlsZSA9IG1pbmlmeUNzcyhub2RlLmF0dHJpYnMuc3R5bGUpO1xuICAgIGNvbnN0IHJlcGxhY2VtZW50Q2xhc3MgPSBzdHlsZU1hcC5nZXQobWluU3R5bGUpO1xuXG4gICAgaWYgKCFub2RlLmF0dHJpYnMuY2xhc3MpIHtcbiAgICAgIG5vZGUuYXR0cmlicy5jbGFzcyA9IHJlcGxhY2VtZW50Q2xhc3M7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vZGUuYXR0cmlicy5jbGFzcyA9IGAke25vZGUuYXR0cmlicy5jbGFzc30gJHtyZXBsYWNlbWVudENsYXNzfWA7XG4gICAgfVxuXG4gICAgLy8gcmVtb3ZlIHRoYXQgbmFzdHkgaW5saW5lIHN0eWxlXG4gICAgbm9kZS5hdHRyaWJzLnN0eWxlID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgcmV0dXJuIG5vZGU7XG59XG5cbmNvbnN0IHJlcGxhY2VTdHlsZUF0dHJzID0gKG5vZGUpID0+IHtcbiAgaWYgKCFub2RlLmNoaWxkcmVuKSB7XG4gICAgLy8gd2UndmUgaGl0IGEgbGVhZiwgcmV0dXJuIHRoZSBjbGVhbmVkIGxlYWZcbiAgICByZXR1cm4gY2xlYW5Ob2RlKG5vZGUpO1xuICB9XG4gIGNsZWFuTm9kZShub2RlKTtcblxuICByZXR1cm4gbm9kZS5jaGlsZHJlbi5tYXAocmVwbGFjZVN0eWxlQXR0cnMpO1xufVxuXG5jb25zdCBjbGVhbkh0bWxUYWdzID0gKGRvbSkgPT4ge1xuICAvLyBmaWx0ZXIgb3V0IHN0eWxlIHRhZ3MgZmlyc3RcbiAgZG9tID0gZG9tLmZpbHRlcihub2RlID0+IHtcbiAgICByZXR1cm4gbm9kZS5uYW1lICE9PSAnc3R5bGUnXG4gIH0pO1xuXG4gIC8vIHRoZW4gbWFwIHRvIHJlcGxhY2UgaW5saW5lIHN0eWxlIGF0dHJzIHdpdGggY2xhc3Nlc1xuICBkb20ubWFwKHJlcGxhY2VTdHlsZUF0dHJzKTtcbn1cblxuY29uc3QgcmVtb3ZlU3R5bGVUYWdzID0gKG5vZGUsIHBhcmVudCkgPT4ge1xuICBpZihub2RlLm5hbWUgPT09ICdzdHlsZScpIHtcbiAgICAvLyB0YWtlIHN0eWxlIHRhZyBpbm5lclRleHQgYW5kIGp1c3QgbW92ZSBpdCBzdHJhaWdodCB0byB0aGUgY3NzIGZpbGVcbiAgICBsZXQgc3R5bGVzID0gbm9kZS5jaGlsZHJlblswXS5kYXRhO1xuXG4gICAgLy8gd2UnbGwgaGF2ZSB0byBwYXJzZSB0aGUgY3NzIHRvIGdldCB0aGUgcHJvcGVydGllcyBvdXQgb2YgaXQgYW5kIGNoZWNrIHRvIHNlZSBpZiB3ZSBjYW5cbiAgICAvLyBtYXRjaCBhbnkgaW5saW5lIHN0eWxlcyB0byBjdXJyZW50bHkgZXhpc3RpbmcgY2xhc3Nlc1xuXG4gICAgLy8gZWFjaCBtYXRjaCB3aWxsIGhhdmUgMyBjYXB0dXJlIGdyb3Vwcy5cbiAgICAvLyAwdGggaXMgdGhlIGZ1bGwgbWF0Y2hcbiAgICAvLyAxc3QgYmVpbmcgdGhlIHNlbGVjdG9yXG4gICAgLy8gMm5kIGlzIHRoZSBwcm9wZXJ0aWVzIGNvbnRhaW5lZCB3aXRoaW4gdGhhdCBydWxlXG4gICAgY29uc3QgY3NzUmVnZXggPSAvKD86KFteXFx7XFx9XSopKSg/OnsoLio/XFxzKil9KSovZ2k7XG4gICAgY29uc3QgbWF0Y2hlcyA9IFtdO1xuICAgIFxuICAgIC8vIGZpbmQgYWxsIG1hdGNoZXMgb2YgcmVnZXggaW4gdGhlIHN0eWxlIHRhZydzIGlubmVyVGV4dFxuICAgIHN0eWxlcyA9IG1pbmlmeUNzcyhzdHlsZXMpO1xuICAgIGxldCBtYXRjaCA9IGNzc1JlZ2V4LmV4ZWMoc3R5bGVzKTtcbiAgICAvLyBpZiB0aGUgZnVsbCBtYXRjaCBpcyBhbiBlbXB0eSBzdHJpbmcgd2UncmUgYWxzbyBkb25lXG4gICAgd2hpbGUgKG1hdGNoICE9PSBudWxsICYmIG1hdGNoWzBdICE9PSAnJykge1xuICAgICAgbWF0Y2hlcy5wdXNoKG1hdGNoKTtcbiAgICAgIG1hdGNoID0gY3NzUmVnZXguZXhlYyhzdHlsZXMpO1xuICAgIH1cblxuICAgIGxldCBjc3NBcnIgPSBtYXRjaGVzLm1hcChtYXRjaCA9PiB7XG4gICAgICByZXR1cm4gcHJldHRpZnlDc3MobWF0Y2hbMV0sIG1hdGNoWzJdKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNzc091dHB1dCA9IGNzc0Fyci5qb2luKCcnKTtcblxuICAgIGZzLmFwcGVuZEZpbGVTeW5jKG9wdGlvbnMub3V0cHV0LCBjc3NPdXRwdXQpO1xuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gcmVtb3ZlIHNlbGYgZnJvbSBET01cbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gbm9kZTsgLy8gb3RoZXJ3aXNlIG5vIHRvdWNoeVxuICB9XG59XG5cbmNvbnN0IG91dHB1dE1vZGlmaWVkU3JjRmlsZSA9IChkb20sIGh0bWxPdXRwdXQpID0+IHtcbiAgLy8gaHRtbC5jb25maWd1cmUoeyBkaXNhYmxlQXR0cmliRXNjYXBlOiB0cnVlIH0pO1xuICBjb25zdCByYXdIdG1sT3V0cHV0ID0gaHRtbChkb20sIHJlbW92ZVN0eWxlVGFncylcbiAgZnMud3JpdGVGaWxlU3luYyhodG1sT3V0cHV0LCByYXdIdG1sT3V0cHV0KTtcbn1cblxuY29uc3QgY3JlYXRlUGFyc2VIYW5kbGVyID0gKGZpbGVuYW1lKSA9PiB7XG4gIHJldHVybiBuZXcgaHRtbHBhcnNlci5EZWZhdWx0SGFuZGxlcigoZXJyLCBkb20pID0+IHtcbiAgICBpZiAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICBwcm9jZXNzLmV4aXQoMSk7IC8vIG9oIG5vIHNvbWV0aGluZyBiYWQgaGFwcGVuZWQuXG4gICAgfSBlbHNlIHtcbiAgICAgIGNsZWFuU3JjRmlsZShkb20sIGZpbGVuYW1lKTtcbiAgICB9XG4gIH0pXG59XG5cbmNvbnN0IGNsZWFuU3JjRmlsZSA9IChkb20sIGZpbGVuYW1lKSA9PiB7XG4gIGNvbnN0IGJhZFN0eWxlcyA9IGdldEJhZFN0eWxlcyhkb20pO1xuICBhZGRJbmxpbmVTdHlsZXNUb1N0eWxlTWFwKGJhZFN0eWxlcyk7XG4gIFxuICBcbiAgY29uc3QgaHRtbE91dHB1dCA9IG9wdGlvbnNbJ25vLXJlcGxhY2UnXSA9PT0gdW5kZWZpbmVkXG4gICAgPyBmaWxlbmFtZVxuICAgIDogY3JlYXRlTW9kaWZpZWROYW1lKGZpbGVuYW1lLCBvcHRpb25zWyduby1yZXBsYWNlJ10pO1xuICBcbiAgc3R5bGVNYXBUb0Nzc0ZpbGUob3B0aW9ucy5vdXRwdXQpO1xuXG4gIGNsZWFuSHRtbFRhZ3MoZG9tKTtcbiAgb3V0cHV0TW9kaWZpZWRTcmNGaWxlKGRvbSwgaHRtbE91dHB1dCk7XG59XG5cbi8vIGRvIHRoZSBzdHVmZiwgYnV0IG9uIGEgZGlyZWN0b3J5XG5jb25zdCBydW5EaXIgPSAocnVuT3B0aW9ucywgd29ya2luZ0RpcikgPT4ge1xuICBsZXQgZGlyID0gd29ya2luZ0RpciA9PT0gdW5kZWZpbmVkXG4gICAgPyBydW5PcHRpb25zLmRpcmVjdG9yeVxuICAgIDogd29ya2luZ0RpcjtcblxuICBsZXQgZW50aXRpZXMgPSBmcy5yZWFkZGlyU3luYyhkaXIpO1xuXG4gIGxldCBmaWxlcyA9IFtdO1xuICBsZXQgZGlycyA9IFtdO1xuXG4gIGVudGl0aWVzLmZvckVhY2goZW50aXR5ID0+IHtcbiAgICBpZiAoZnMubHN0YXRTeW5jKGAke2Rpcn0vJHtlbnRpdHl9YCkuaXNGaWxlKCkpIHtcbiAgICAgIGZpbGVzLnB1c2goZW50aXR5KTtcbiAgICB9IGVsc2UgaWYgKGZzLmxzdGF0U3luYyhgJHtkaXJ9LyR7ZW50aXR5fWApLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgIGRpcnMucHVzaChlbnRpdHkpO1xuICAgIH1cbiAgfSk7XG5cbiAgZmlsZXMgPSBmaWx0ZXJGaWxldHlwZXMoZmlsZXMpO1xuXG4gIGNvbnN0IGlzTGVhZkRpciA9IGRpcnMubGVuZ3RoID09PSAwO1xuXG4gIGZpbGVzLmZvckVhY2goZmlsZSA9PiB7XG4gICAgbGV0IGZpbGVuYW1lID0gYCR7ZGlyfS8ke2ZpbGV9YDtcbiAgICBsZXQgZmlsZUNvbnRlbnRzID0gZ2V0RmlsZUNvbnRlbnRzKGZpbGVuYW1lKTtcblxuICAgIGxldCBwYXJzZXIgPSBuZXcgaHRtbHBhcnNlci5QYXJzZXIoY3JlYXRlUGFyc2VIYW5kbGVyKGZpbGVuYW1lKSk7XG4gICAgcGFyc2VyLnBhcnNlQ29tcGxldGUoZmlsZUNvbnRlbnRzKTtcbiAgfSk7XG5cbiAgaWYgKHJ1bk9wdGlvbnMucmVjdXJzaXZlICYmICFpc0xlYWZEaXIpIHtcbiAgICBkaXJzLmZvckVhY2goZCA9PiBydW5EaXIocnVuT3B0aW9ucywgYCR7ZGlyfS8ke2R9YCkpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybjtcbiAgfVxufVxuXG5jb25zdCBmaWx0ZXJGaWxldHlwZXMgPSAoZmlsZW5hbWVzKSA9PiB7XG4gIGlmIChvcHRpb25zLmZpbGV0eXBlKSB7XG4gICAgY29uc3QgZmlsZXR5cGVSZWdleGVzID0gb3B0aW9ucy5maWxldHlwZS5tYXAoZmlsZXR5cGUgPT4ge1xuICAgICAgcmV0dXJuIG5ldyBSZWdFeHAoYCAke2ZpbGV0eXBlfSRgLCAnaScpO1xuICAgIH0pO1xuXG4gICAgZmlsZW5hbWVzID0gZmlsZW5hbWVzLmZpbHRlcihmaWxlbmFtZSA9PiB7XG4gICAgICByZXR1cm4gZmlsZXR5cGVSZWdleGVzLm1hcChyZWdleCA9PiB7XG4gICAgICAgIHJldHVybiByZWdleC50ZXN0KGZpbGVuYW1lKTtcbiAgICAgIH0pLmluY2x1ZGVzKHRydWUpO1xuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGZpbGVuYW1lcztcbn1cblxuLy8gZG8gdGhlIHN0dWZmXG5jb25zdCBydW4gPSAocnVuT3B0aW9ucykgPT4ge1xuICAvLyB1c2Ugb3B0aW9ucyBpbnN0ZWFkIG9mIHJ1bk9wdGlvbnMgaWYgYmVpbmcgcnVuIHRocm91Z2hcbiAgLy8gY2xpIGFzIG9wcG9zZWQgdG8gdmlhIGFub3RoZXIgc2NyaXB0XG4gIG9wdGlvbnMgPSBydW5PcHRpb25zO1xuXG4gIGlmIChydW5PcHRpb25zLmhlbHAgfHwgKCFydW5PcHRpb25zLnNyYyAmJiAhcnVuT3B0aW9ucy5kaXJlY3RvcnkpKSB7XG4gICAgLy8gcHJpbnQgaGVscCBtZXNzYWdlIGlmIG5vdCB1c2VkIHByb3Blcmx5XG4gICAgY29uc29sZS5sb2codXNhZ2UpO1xuICB9IGVsc2UgaWYgKHJ1bk9wdGlvbnMuZGlyZWN0b3J5KSB7XG4gICAgcnVuRGlyKHJ1bk9wdGlvbnMpO1xuICB9IGVsc2Uge1xuICAgIC8vIGRpZG4ndCB1c2UgZGlyZWN0b3J5IG1vZGVcbiAgICBsZXQgZmlsZW5hbWVzID0gb3B0aW9ucy5zcmM7XG5cbiAgICBmaWxlbmFtZXMgPSBmaWx0ZXJGaWxldHlwZXMoZmlsZW5hbWVzKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcnVuT3B0aW9ucy5zcmMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGxldCBjdXJyZW50RmlsZSA9IHJ1bk9wdGlvbnMuc3JjW2ldO1xuICAgICAgbGV0IGZpbGVDb250ZW50cyA9IGdldEZpbGVDb250ZW50cyhjdXJyZW50RmlsZSk7XG4gICAgICBcbiAgICAgIGxldCBwYXJzZXIgPSBuZXcgaHRtbHBhcnNlci5QYXJzZXIoY3JlYXRlUGFyc2VIYW5kbGVyKGN1cnJlbnRGaWxlKSk7XG4gICAgICBwYXJzZXIucGFyc2VDb21wbGV0ZShmaWxlQ29udGVudHMpO1xuICAgIH1cbiAgfVxufVxuXG4vLyBzdGFydCB1cCB0aGUgc2NyaXB0IHdoZW4gcnVuIGZyb20gY29tbWFuZCBsaW5lXG4vLyBvdGhlcndpc2UgZG9uJ3QgcnVuIHRoZSBzY3JpcHQsIHdhaXQgZm9yIHNvbWVvbmVcbi8vIHdobyBpbXBvcnRlZCBpdCB0byBzdGFydCBpdCB1cC5cbmlmIChyZXF1aXJlLm1haW4gPT09IG1vZHVsZSkge1xuICBydW4oY2xpT3B0aW9ucyk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IHJ1bjsiXX0=
