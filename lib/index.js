'use strict';

const isComponent = require('./helpers/is-component');
const isNullOrUndefined = require('./helpers/is-null-or-undefined');
const VNodeFlags = require('./flags');

function handleWhiteSpace(str) {
	return str.replace(/\t|(\s*[\r\n]\s*)/g, '');
}

function hasHyphenOrColon(attr) {
	return attr.indexOf('-') !== -1 || attr.indexOf(':') !== -1;
}

function getVNodeType(t, type) {
	const astType = type.type;
	let component = false;
	let flags;

	if (astType === 'JSXIdentifier') {
		if (isComponent(type.name)) {
			component = true;
			flags = VNodeFlags.ComponentUnknown;
		} else {
			const tag = type.name;

			type = t.StringLiteral(tag);
			switch (tag) {
				case 'svg':
					flags = VNodeFlags.SvgElement;
					break;
				case 'input':
					flags = VNodeFlags.InputElement;
					break;
				case 'textarea':
					flags = VNodeFlags.TextareaElement;
					break;
				case 'select':
					flags = VNodeFlags.SelectElement;
					break;
				case 'media':
					flags = VNodeFlags.MediaElement;
					break;
				default:
					flags = VNodeFlags.HtmlElement;
			}
		}
	} else if (astType === 'JSXMemberExpression') {
		component = true;
		flags = VNodeFlags.ComponentUnknown;
	}
	return {
		type: type,
		isComponent: component,
		flags: flags
	};
}

function getVNodeChildren(t, astChildren) {
	let children = [];

	for (let i = 0; i < astChildren.length; i++) {
		const child = astChildren[i];
		const vNode = createVNode(t, child);

		if (!isNullOrUndefined(vNode)) {
			children.push(vNode);
		}
	}
	return children.length === 1 ? children[0] : t.arrayExpression(children);
}

function getValue(t, value) {
	if (!value) {
		return t.BooleanLiteral(true);
	}

	if (value.type === 'JSXExpressionContainer') {
		return value.expression;
	}

	return value;
}

function getName(t, name) {
	if (name.indexOf('-') !== 0) {
		return t.StringLiteral(name);
	}
	return t.identifier(name);
}

function getVNodeProps(t, astProps, isComponent) {
	let props = [];
	let key = null;
	let ref = null;
	let hasKeyedChildren = false;
	let hasNonKeyedChildren = false;
	let noNormalize = false;

	for (let i = 0; i < astProps.length; i++) {
		const astProp = astProps[i];

		if (astProp.type === 'JSXSpreadAttribute') {
			props.push({
				astName: null,
				astValue: null,
				astSpread: astProp.argument
			});
		} else {
			let propName = astProp.name;

			if (propName.type === 'JSXIdentifier') {
				propName = propName.name;
			} else if (propName.type === 'JSXNamespacedName') {
				propName = propName.namespace.name + ':' + propName.name.name;
			}
			if (propName.substr(0, 11) === 'onComponent' && isComponent) {
				if (!ref) {
					ref = t.ObjectExpression([]);
				}
				ref.properties.push(
					t.ObjectProperty(getName(t, propName), getValue(t, astProp.value))
				);
			} else {
				switch (propName) {
					case 'noNormalize':
						noNormalize = true;
						break;
					case 'hasNonKeyedChildren':
						hasNonKeyedChildren = true;
						break;
					case 'hasKeyedChildren':
						hasKeyedChildren = true;
						break;
					case 'ref':
						ref = getValue(t, astProp.value);
						break;
					case 'key':
						key = getValue(t, astProp.value);
						break;
					default:
						props.push({
							astName: getName(t, propName),
							astValue: getValue(t, astProp.value),
							astSpread: null
						});
				}
			}
		}
	}

	/* eslint no-return-assign:0 */
	return {
		props: isNullOrUndefined(props) ? t.identifier('null') : props = t.ObjectExpression(
			props.map(prop =>
				!prop.astSpread
				? t.ObjectProperty(prop.astName, prop.astValue)
				: t.SpreadProperty(prop.astSpread)
			)
		),
		key: isNullOrUndefined(key) ? t.identifier('null') : key,
		ref: isNullOrUndefined(ref) ? t.identifier('null') : ref,
		hasKeyedChildren: hasKeyedChildren,
		hasNonKeyedChildren: hasNonKeyedChildren,
		noNormalize: noNormalize
	};
}

function isAstNull(ast) {
	if (ast.type === 'ArrayExpression' && ast.elements.length === 0) {
		return true;
	}
	return !ast || ast.name === 'null';
}

function createVNodeArgs(t, flags, type, props, children, key, ref, noNormalize) {
	const args = [];
	const nill = t.identifier('null');

	if (noNormalize) {
		args.unshift(t.BooleanLiteral(true));
	}

	if (!isAstNull(ref)) {
		args.unshift(ref);
	} else if (noNormalize) {
		args.unshift(nill);
	}

	if (!isAstNull(key)) {
		args.unshift(key);
	} else if (!isAstNull(ref) || noNormalize) {
		args.unshift(nill);
	}

	if (!isAstNull(children)) {
		args.unshift(children);
	} else if (!isAstNull(key) || !isAstNull(ref) || noNormalize) {
		args.unshift(nill);
	}

	if (props.properties && props.properties.length > 0) {
		args.unshift(props);
	} else if (!isAstNull(children) || !isAstNull(key) || !isAstNull(ref) || noNormalize) {
		args.unshift(nill);
	}

	args.unshift(type);
	args.unshift(t.NumericLiteral(flags));
	return args;
}

function createVNode(t, astNode) {
	const astType = astNode.type;

	switch (astType) {
		case 'JSXElement':
			const openingElement = astNode.openingElement;
			const vType = getVNodeType(t, openingElement.name);
			const vProps = getVNodeProps(t, openingElement.attributes, vType.isComponent);
			let vChildren = getVNodeChildren(t, astNode.children);

			let flags = vType.flags;
			let props = vProps.props;

			if (vProps.hasKeyedChildren) {
				flags = flags | VNodeFlags.HasKeyedChildren;
			}
			if (vProps.hasNonKeyedChildren) {
				flags = flags | VNodeFlags.HasNonKeyedChildren;
			}
			if (vType.isComponent && vChildren) {
				let addChildrenToProps = true;

				if (vChildren.type === 'ArrayExpression' && vChildren.elements.length === 0) {
					addChildrenToProps = false;
				}
				if (addChildrenToProps) {
					if (props.properties) {
						props.properties.push(
							t.ObjectProperty(
								t.identifier('children'),
								vChildren
							)
						);
					} else {
						props = t.ObjectExpression([
							t.ObjectProperty(
								t.identifier('children'),
								vChildren
							)
						]);
					}
				}
				vChildren = t.identifier('null');
			}

			return t.callExpression(
				t.memberExpression(t.identifier('Inferno'), t.identifier('createVNode')),
				createVNodeArgs(
					t,
					flags,
					vType.type,
					props,
					vChildren,
					vProps.key,
					vProps.ref,
					vProps.noNormalize
				)
			);
		case 'JSXText':
			const text = handleWhiteSpace(astNode.value);

			if (text !== '') {
				return t.StringLiteral(text);
			}
			break;
		case 'JSXExpressionContainer':
			const expression = astNode.expression;

			if (expression && expression.type !== 'JSXEmptyExpression') {
				return expression;
			}
			break;
		default:
			// TODO
			break;
	}
}

module.exports = function (options) {
	const t = options.types;

	return {
		visitor: {
			JSXElement: {
				enter: function (path) {
					const node = createVNode(t, path.node);
					path.replaceWith(node);
				}
			}
		},
		inherits: require('babel-plugin-syntax-jsx')
	};
};
