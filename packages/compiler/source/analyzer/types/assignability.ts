import { numericTypeNames } from './type.js'
import type {
  FunctionType,
  LiteralType,
  MappedType,
  ObjectType,
  ReferenceType,
  TemplateLiteralType,
  TupleType,
  Type,
} from './type.js'

/**
 * Determines whether a value of the source type can be used where the target type is expected,
 * following structural typing.
 *
 * @param source Type of the value being assigned.
 * @param target Type expected in the destination.
 * @returns Whether the assignment is allowed.
 */
export function isAssignableTo(source: Type, target: Type): boolean {
  if (target.kind === 'unknown' || source.kind === 'never') {
    return true
  }

  if (source.kind === 'unknown' || target.kind === 'never') {
    return false
  }

  if (source.kind === 'conditional') {
    return isAssignableTo(source.trueType, target) && isAssignableTo(source.falseType, target)
  }

  if (source.kind === 'union') {
    return source.types.every((member) => isAssignableTo(member, target))
  }

  if (target.kind === 'union') {
    return target.types.some((member) => isAssignableTo(source, member))
  }

  if (source.kind === 'intersection') {
    return source.types.some((member) => isAssignableTo(member, target))
  }

  if (target.kind === 'intersection') {
    return target.types.every((member) => isAssignableTo(source, member))
  }

  if (target.kind === 'void') {
    return source.kind === 'void' || (source.kind === 'primitive' && source.name === 'undefined')
  }

  if (source.kind === 'literal') {
    return isLiteralAssignableTo(source, target)
  }

  if (source.kind === 'primitive' && target.kind === 'primitive') {
    return source.name === target.name
  }

  if (source.kind === 'array' && target.kind === 'array') {
    return isAssignableTo(source.elementType, target.elementType)
  }

  if (source.kind === 'tuple' && target.kind === 'tuple') {
    return isTupleAssignableTo(source, target)
  }

  if (source.kind === 'object' && target.kind === 'object') {
    return isObjectAssignableTo(source, target)
  }

  if (source.kind === 'function' && target.kind === 'function') {
    return isFunctionAssignableTo(source, target)
  }

  if (source.kind === 'reference' && target.kind === 'reference') {
    return isReferenceAssignableTo(source, target)
  }

  if (source.kind === 'enum' && target.kind === 'enum') {
    return source.name === target.name
  }

  if (source.kind === 'uniqueSymbol' && target.kind === 'uniqueSymbol') {
    return true
  }

  if (source.kind === 'templateLiteral') {
    return isTemplateAssignableTo(source, target)
  }

  if (target.kind === 'conditional') {
    return isAssignableTo(source, target.trueType) && isAssignableTo(source, target.falseType)
  }

  if (source.kind === 'mapped' && target.kind === 'mapped') {
    return isMappedAssignableTo(source, target)
  }

  return false
}

/**
 * Determines whether a literal value can be used where the target type is expected.
 */
function isLiteralAssignableTo(source: LiteralType, target: Type): boolean {
  if (target.kind === 'literal') {
    return source.primitive === target.primitive && source.value === target.value
  }

  if (target.kind === 'templateLiteral') {
    return source.primitive === 'string' && matchesTemplateParts(String(source.value), target.parts)
  }

  return target.kind === 'primitive' && target.name === source.primitive
}

/**
 * Determines whether an object value can be used where the target type is expected. The source may
 * declare extra properties, but every target property must be present with an assignable type.
 */
function isObjectAssignableTo(source: ObjectType, target: ObjectType): boolean {
  return target.properties.every((property) => {
    const sourceProperty = source.properties.find((candidate) => candidate.name === property.name)

    if (sourceProperty === undefined) {
      return property.optional
    }

    if (sourceProperty.optional && !property.optional) {
      return false
    }

    return isAssignableTo(sourceProperty.type, property.type)
  })
}

/**
 * Determines whether a function can be used where the target type is expected. Parameters are
 * checked contravariantly, the return type covariantly, and the source may declare fewer
 * parameters than the target.
 */
function isFunctionAssignableTo(source: FunctionType, target: FunctionType): boolean {
  if (source.parameters.length > target.parameters.length) {
    return false
  }

  const parametersMatch = target.parameters.every((parameter, index) => {
    const sourceParameter = source.parameters[index]

    if (sourceParameter === undefined) {
      return parameter.optional
    }

    return isAssignableTo(parameter.type, sourceParameter.type)
  })

  if (!parametersMatch) {
    return false
  }

  if (target.returnType.kind === 'void') {
    return true
  }

  return isAssignableTo(source.returnType, target.returnType)
}

/**
 * Determines whether a named type can be used where the target type is expected. References are
 * compared by name until the analyzer resolves their declarations.
 */
function isReferenceAssignableTo(source: ReferenceType, target: ReferenceType): boolean {
  if (source.name !== target.name || source.typeArguments.length !== target.typeArguments.length) {
    return false
  }

  return source.typeArguments.every((argument, index) => {
    const targetArgument = target.typeArguments[index]

    return targetArgument !== undefined && isAssignableTo(argument, targetArgument)
  })
}

/**
 * Determines whether a tuple can be used where the target type is expected. Both tuples must have
 * the same length and pairwise assignable element types.
 */
function isTupleAssignableTo(source: TupleType, target: TupleType): boolean {
  if (source.elementTypes.length !== target.elementTypes.length) {
    return false
  }

  return source.elementTypes.every((elementType, index) => {
    const targetElement = target.elementTypes[index]

    return targetElement !== undefined && isAssignableTo(elementType, targetElement)
  })
}

/**
 * Determines whether a template literal value can be used where the target type is expected.
 */
function isTemplateAssignableTo(source: TemplateLiteralType, target: Type): boolean {
  if (target.kind === 'templateLiteral') {
    return templatePartsMatch(source.parts, target.parts)
  }

  return target.kind === 'primitive' && target.name === 'string'
}

/**
 * Determines whether two template literal types accept the same shapes.
 */
function templatePartsMatch(
  source: readonly (string | Type)[],
  target: readonly (string | Type)[],
): boolean {
  if (source.length !== target.length) {
    return false
  }

  return source.every((part, index) => {
    const targetPart = target[index]

    if (targetPart === undefined) {
      return false
    }

    if (typeof part === 'string' || typeof targetPart === 'string') {
      return part === targetPart
    }

    return isAssignableTo(part, targetPart) && isAssignableTo(targetPart, part)
  })
}

/**
 * Determines whether a string value matches the pattern described by the template parts.
 */
function matchesTemplateParts(value: string, parts: readonly (string | Type)[]): boolean {
  if (parts.length === 0) {
    return value.length === 0
  }

  const first = parts[0]

  if (first === undefined) {
    return false
  }

  if (typeof first === 'string') {
    if (!value.startsWith(first)) {
      return false
    }

    return matchesTemplateParts(value.slice(first.length), parts.slice(1))
  }

  return matchesPlaceholder(value, first, parts.slice(1))
}

/**
 * Matches the segment of the value consumed by a template placeholder.
 */
function matchesPlaceholder(
  value: string,
  placeholder: Type,
  rest: readonly (string | Type)[],
): boolean {
  if (placeholder.kind === 'union') {
    return placeholder.types.some((member) => matchesPlaceholder(value, member, rest))
  }

  if (placeholder.kind === 'literal' && placeholder.primitive === 'string') {
    const text = String(placeholder.value)

    if (!value.startsWith(text)) {
      return false
    }

    return matchesTemplateParts(value.slice(text.length), rest)
  }

  if (placeholder.kind === 'primitive' && placeholder.name === 'string') {
    return splitEvery(value, rest)
  }

  if (placeholder.kind === 'primitive' && numericTypeNames.has(placeholder.name)) {
    return splitNumeric(value, rest)
  }

  return false
}

/**
 * Tries every split of the value for a placeholder that accepts any text.
 */
function splitEvery(value: string, rest: readonly (string | Type)[]): boolean {
  for (let length = 0; length <= value.length; length++) {
    if (matchesTemplateParts(value.slice(length), rest)) {
      return true
    }
  }

  return false
}

/**
 * Tries every split of the value for a placeholder that accepts numbers.
 */
function splitNumeric(value: string, rest: readonly (string | Type)[]): boolean {
  for (let length = 1; length <= value.length; length++) {
    const segment = value.slice(0, length)

    if (Number.isFinite(Number(segment)) && matchesTemplateParts(value.slice(length), rest)) {
      return true
    }
  }

  return false
}

/**
 * Determines whether a mapped type can be used where the target type is expected. Mapped types are
 * compared by their declaration until the analyzer evaluates them.
 */
function isMappedAssignableTo(source: MappedType, target: MappedType): boolean {
  return (
    source.parameter === target.parameter &&
    isOptionalTypeAssignableTo(source.constraint, target.constraint) &&
    isOptionalTypeAssignableTo(source.nameType, target.nameType) &&
    isAssignableTo(source.template, target.template)
  )
}

/**
 * Compares two types that may be absent.
 */
function isOptionalTypeAssignableTo(source: Type | undefined, target: Type | undefined): boolean {
  if (source === undefined || target === undefined) {
    return source === target
  }

  return isAssignableTo(source, target)
}
