import * as ts from 'typescript'

import type {
  ConditionalType,
  FunctionParameter,
  FunctionType,
  GenericParameter,
  MappedType,
  ObjectType,
  PrimitiveName,
  TemplateLiteralType,
  TupleType,
  Type,
  TypeProperty,
} from './type.js'
import {
  booleanType,
  f64Type,
  i32Type,
  i64Type,
  neverType,
  nullType,
  numericTypeNames,
  stringType,
  undefinedType,
  uniqueSymbolType,
  unknownType,
  voidType,
} from './type.js'

/** Types of the type keywords recognized by the language. */
const keywordTypes: { [kind in ts.SyntaxKind]?: Type } = {
  [ts.SyntaxKind.AnyKeyword]: unknownType,
  [ts.SyntaxKind.BooleanKeyword]: booleanType,
  [ts.SyntaxKind.NeverKeyword]: neverType,
  [ts.SyntaxKind.NullKeyword]: nullType,
  [ts.SyntaxKind.StringKeyword]: stringType,
  [ts.SyntaxKind.UndefinedKeyword]: undefinedType,
  [ts.SyntaxKind.UnknownKeyword]: unknownType,
  [ts.SyntaxKind.VoidKeyword]: voidType,
}

/** Keywords that used to be types and were replaced by the numeric zoo. */
const removedKeywords: { [kind in ts.SyntaxKind]?: string } = {
  [ts.SyntaxKind.BigIntKeyword]: 'bigint',
  [ts.SyntaxKind.NumberKeyword]: 'i32 or f64',
  [ts.SyntaxKind.ObjectKeyword]: 'a class or an object type',
}

/**
 * Converts a type node produced by the parser into a Shift type.
 *
 * @param node Type node from the syntax tree.
 * @returns The equivalent Shift type.
 * @throws When the node uses type syntax that has no representation in the model yet.
 */
export function typeFromNode(node: ts.TypeNode): Type {
  const keywordType = keywordTypes[node.kind]

  if (keywordType !== undefined) {
    return keywordType
  }

  const removed = removedKeywords[node.kind]

  if (removed !== undefined) {
    throw new Error(`The '${ts.SyntaxKind[node.kind]}' type was removed. Use ${removed} instead.`)
  }

  if (ts.isLiteralTypeNode(node)) {
    return typeFromLiteral(node)
  }

  if (ts.isArrayTypeNode(node)) {
    return { kind: 'array', elementType: typeFromNode(node.elementType) }
  }

  if (ts.isTupleTypeNode(node)) {
    return typeFromTuple(node)
  }

  if (ts.isParenthesizedTypeNode(node)) {
    return typeFromNode(node.type)
  }

  if (ts.isUnionTypeNode(node)) {
    return { kind: 'union', types: node.types.map((member) => typeFromNode(member)) }
  }

  if (ts.isIntersectionTypeNode(node)) {
    return typeFromIntersection(node)
  }

  if (ts.isFunctionTypeNode(node)) {
    return typeFromFunction(node)
  }

  if (ts.isTypeLiteralNode(node)) {
    return typeFromTypeLiteral(node)
  }

  if (ts.isMappedTypeNode(node)) {
    return typeFromMapped(node)
  }

  if (ts.isConditionalTypeNode(node)) {
    return typeFromConditional(node)
  }

  if (ts.isTemplateLiteralTypeNode(node)) {
    return typeFromTemplate(node)
  }

  if (ts.isTypeOperatorNode(node)) {
    return typeFromOperator(node)
  }

  if (ts.isTypeReferenceNode(node)) {
    return typeFromReference(node)
  }

  throw new Error(`Unsupported type syntax: ${ts.SyntaxKind[node.kind]}.`)
}

/**
 * Converts a literal type node into its type.
 */
function typeFromLiteral(node: ts.LiteralTypeNode): Type {
  const literal = node.literal

  if (ts.isStringLiteral(literal)) {
    return { kind: 'literal', primitive: 'string', value: literal.text }
  }

  if (ts.isNumericLiteral(literal)) {
    return numericLiteralType(Number(literal.text))
  }

  if (literal.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: 'literal', primitive: 'boolean', value: true }
  }

  if (literal.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: 'literal', primitive: 'boolean', value: false }
  }

  if (literal.kind === ts.SyntaxKind.NullKeyword) {
    return nullType
  }

  throw new Error(`Unsupported literal type: ${ts.SyntaxKind[literal.kind]}.`)
}

/**
 * Converts an intersection type node into its type. A single-member intersection is the syntax the
 * parser produces for `&T`, which has no meaning in the language.
 */
function typeFromIntersection(node: ts.IntersectionTypeNode): Type {
  if (node.types.length === 1) {
    throw new Error('Reference types are not supported.')
  }

  return { kind: 'intersection', types: node.types.map((member) => typeFromNode(member)) }
}

/**
 * Types an integer literal, widening it when it does not fit in i32.
 */
function numericLiteralType(value: number): Type {
  if (!Number.isInteger(value)) {
    return f64Type
  }

  if (value < -2147483648 || value > 2147483647) {
    return i64Type
  }

  return i32Type
}

/**
 * Converts a tuple type node into its type. Element names and optionality are not preserved.
 */
function typeFromTuple(node: ts.TupleTypeNode): TupleType {
  return {
    kind: 'tuple',
    elementTypes: node.elements.map((element) =>
      ts.isNamedTupleMember(element) ? typeFromNode(element.type) : typeFromNode(element),
    ),
  }
}

/**
 * Converts a function type node into its type.
 */
function typeFromFunction(node: ts.FunctionTypeNode): FunctionType {
  return {
    kind: 'function',
    parameters: node.parameters.map((parameter) => parameterFromNode(parameter)),
    returnType: typeFromNode(node.type),
    typeParameters: (node.typeParameters ?? []).map((parameter) =>
      genericParameterFromNode(parameter),
    ),
  }
}

/**
 * Converts a parameter of a function type into its parameter.
 */
function parameterFromNode(node: ts.ParameterDeclaration): FunctionParameter {
  const name = node.name

  if (!ts.isIdentifier(name)) {
    throw new Error('Function type parameters require a simple name.')
  }

  if (node.type === undefined) {
    throw new Error('Function type parameters require a type annotation.')
  }

  return {
    name: name.text,
    type: typeFromNode(node.type),
    optional: node.questionToken !== undefined,
  }
}

/**
 * Converts a generic parameter declaration into its parameter.
 */
function genericParameterFromNode(node: ts.TypeParameterDeclaration): GenericParameter {
  if (!ts.isIdentifier(node.name)) {
    throw new Error('Generic parameters require a simple name.')
  }

  return {
    name: node.name.text,
    constraint: node.constraint === undefined ? undefined : typeFromNode(node.constraint),
    defaultType: node.default === undefined ? undefined : typeFromNode(node.default),
  }
}

/**
 * Converts a type literal node into an object type.
 */
function typeFromTypeLiteral(node: ts.TypeLiteralNode): ObjectType {
  return { kind: 'object', properties: node.members.map((member) => propertyFromNode(member)) }
}

/**
 * Converts a member of a type literal into an object type property.
 */
function propertyFromNode(node: ts.TypeElement): TypeProperty {
  if (ts.isPropertySignature(node)) {
    if (node.type === undefined) {
      throw new Error('Object type properties require a type annotation.')
    }

    return {
      name: nameOf(node.name),
      type: typeFromNode(node.type),
      optional: node.questionToken !== undefined,
    }
  }

  if (ts.isMethodSignature(node)) {
    if (node.type === undefined) {
      throw new Error('Object type methods require a return type annotation.')
    }

    return {
      name: nameOf(node.name),
      type: {
        kind: 'function',
        parameters: node.parameters.map((parameter) => parameterFromNode(parameter)),
        returnType: typeFromNode(node.type),
        typeParameters: (node.typeParameters ?? []).map((parameter) =>
          genericParameterFromNode(parameter),
        ),
      },
      optional: node.questionToken !== undefined,
    }
  }

  throw new Error(`Unsupported object type member: ${ts.SyntaxKind[node.kind]}.`)
}

/**
 * Reads the name of an object type member.
 */
function nameOf(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  throw new Error('Object type members require a simple name.')
}

/**
 * Converts a mapped type node into its type.
 */
function typeFromMapped(node: ts.MappedTypeNode): MappedType {
  const parameter = node.typeParameter.name

  if (!ts.isIdentifier(parameter)) {
    throw new Error('Mapped type parameters require a simple name.')
  }

  if (node.typeParameter.constraint === undefined) {
    throw new Error('Mapped types require a constraint.')
  }

  if (node.type === undefined) {
    throw new Error('Mapped types require a template type.')
  }

  return {
    kind: 'mapped',
    parameter: parameter.text,
    constraint: typeFromNode(node.typeParameter.constraint),
    nameType: node.nameType === undefined ? undefined : typeFromNode(node.nameType),
    template: typeFromNode(node.type),
  }
}

/**
 * Converts a conditional type node into its type.
 */
function typeFromConditional(node: ts.ConditionalTypeNode): ConditionalType {
  return {
    kind: 'conditional',
    checkType: typeFromNode(node.checkType),
    extendsType: typeFromNode(node.extendsType),
    trueType: typeFromNode(node.trueType),
    falseType: typeFromNode(node.falseType),
  }
}

/**
 * Converts a template literal type node into its type.
 */
function typeFromTemplate(node: ts.TemplateLiteralTypeNode): TemplateLiteralType {
  const parts: (string | Type)[] = [node.head.text]

  for (const span of node.templateSpans) {
    parts.push(typeFromNode(span.type), span.literal.text)
  }

  return { kind: 'templateLiteral', parts }
}

/**
 * Converts a type operator node into its type.
 */
function typeFromOperator(node: ts.TypeOperatorNode): Type {
  if (node.operator === ts.SyntaxKind.UniqueKeyword) {
    return uniqueSymbolType
  }

  throw new Error(`Unsupported type operator: ${ts.SyntaxKind[node.operator]}.`)
}

/**
 * Converts a type reference node into its type.
 */
function typeFromReference(node: ts.TypeReferenceNode): Type {
  if (!ts.isIdentifier(node.typeName)) {
    throw new Error('Type references require a simple name.')
  }

  const name = node.typeName.text

  if (numericTypeNames.has(name)) {
    return { kind: 'primitive', name: name as PrimitiveName }
  }

  return {
    kind: 'reference',
    name,
    typeArguments: (node.typeArguments ?? []).map((argument) => typeFromNode(argument)),
  }
}
