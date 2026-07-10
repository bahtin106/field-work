import React from 'react';
import { StyleSheet, View } from 'react-native';
import ListSeparator from './ListSeparator';

export const flattenRenderableChildren = (nodes, output = []) => {
  React.Children.forEach(nodes, (node) => {
    if (node === null || node === undefined || node === false) return;
    if (React.isValidElement(node) && node.type === React.Fragment) {
      flattenRenderableChildren(node.props.children, output);
      return;
    }
    output.push(node);
  });
  return output;
};

const looksLikeThinSeparatorView = (node) => {
  if (!React.isValidElement(node) || node.type !== View) return false;
  if (node.props?.children !== undefined && node.props?.children !== null && node.props?.children !== false) {
    return false;
  }
  const flattened = StyleSheet.flatten(node.props?.style);
  if (!flattened || typeof flattened !== 'object') return false;
  const height = Number(flattened.height);
  if (!Number.isFinite(height) || height <= 0 || height > 2) return false;
  return typeof flattened.backgroundColor === 'string' && flattened.backgroundColor.length > 0;
};

export const isSeparatorLikeNode = (node) => {
  if (!React.isValidElement(node)) return false;
  return node.type === ListSeparator || looksLikeThinSeparatorView(node);
};

export const getSeparatedRows = (children) =>
  React.Children.toArray(flattenRenderableChildren(children)).filter(
    (node) => !isSeparatorLikeNode(node),
  );

export const interleaveSeparators = (rows) =>
  React.Children.toArray(
    rows.flatMap((node, index) =>
      index === 0
        ? [node]
        : [<ListSeparator key={`list-separator-${index}`} />, node],
    ),
  );
