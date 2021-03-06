"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fontTagSizeToCss = exports.getDeprecatedAttrsForNode = exports.hasDeprecatedAttrs = exports.isTagDeprecated = exports.deprecatedAttrs = exports.deprecatedTags = void 0;
const deprecatedTags = ['acronym', 'applet', 'basefont', 'big', 'center', 'dir', 'font', 'frame', 'frameset', 'isindex', 'noframes', 's', 'strike', 'tt', 'u'];
exports.deprecatedTags = deprecatedTags;
const deprecatedAttrs = ['rev', 'charset', 'shape', 'coords', 'longdesc', 'target', 'nohref', 'profile', 'version', 'name', 'scheme', 'archive', 'classid', 'codebase', 'codetype', 'declare', 'standby', 'valuetype', 'type', 'axis', 'abbr', 'scope', 'align', 'alink', 'link', 'vlink', 'text', 'background', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'char', 'charoff', 'clear', 'compact', 'frame', 'compact', 'frame', 'frameborder', 'hspace', 'vspace', 'marginheight', 'marginwidth', 'noshade', 'nowrap', 'rules', 'scrolling', 'size', 'type', 'valign', 'width'];
exports.deprecatedAttrs = deprecatedAttrs;

const isTagDeprecated = node => {
  return deprecatedTags.includes(node.name);
};

exports.isTagDeprecated = isTagDeprecated;

const hasDeprecatedAttrs = node => {
  if (node.attribs) {
    return Object.keys(node.attribs).some(attr => deprecatedAttrs.includes(attr));
  } // node has no attrs, thus no deprecated attrs


  return false;
};

exports.hasDeprecatedAttrs = hasDeprecatedAttrs;

const getDeprecatedAttrsForNode = node => {
  if (node.attribs) {
    return Object.keys(node.attribs).filter(attr => deprecatedAttrs.includes(attr));
  } // return empty array if node has no attrs


  return [];
};

exports.getDeprecatedAttrsForNode = getDeprecatedAttrsForNode;

const fontTagSizeToCss = size => {
  const defaultSize = 3; // handle relative sizes

  if (size.charAt(0) === '-') {
    size = defaultSize - +size.charAt(1);
  } else if (size.charAt(1) === '+') {
    size = defaultSize + +size.charAt(1);
  }

  switch (size) {
    case 1:
      size = 'x-small';
      break;

    case 2:
      size = 'small';
      break;

    case 3:
      size = 'medium';
      break;

    case 4:
      size = 'large';
      break;

    case 5:
      size = 'x-large';
      break;

    case 6:
      size = 'xx-large';
      break;

    case 7:
      size = 'xx-large';
      break;

    default:
      size = 'medium';
      break;
  }

  return size;
};

exports.fontTagSizeToCss = fontTagSizeToCss;