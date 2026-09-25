/******************************************************************************
 * State Diagram language (.nxd)
 *
 * A textual description of an unlabelled, directed, finite state transition
 * system M = (S, ->, L) together with the atoms/attributes labelling each
 * state and the temporal properties to verify with nuXmv.
 *
 *   diagram ResourceMonitor
 *
 *   attributes {
 *     status  : { ready, busy };
 *     request : boolean;
 *   }
 *
 *   initial state s0 { status = ready, request = TRUE } at (80, 80)
 *   state s1 { status = busy, request = TRUE }
 *
 *   s0 -> s1;
 *   s1 -> s0 : "release";
 *
 *   LTLSPEC G (request -> F status = busy);
 ******************************************************************************/
grammar StateDiagram

entry Diagram:
    ('diagram' name=DiagramName)?
    (elements+=Element)*;

// The diagram name only appears in a comment of the nuXmv model, so the
// single-letter temporal operators are accepted there.
DiagramName returns string:
    ID | 'G' | 'F' | 'X' | 'U' | 'V' | 'Y' | 'Z' | 'H' | 'O' | 'S' | 'T' | 'A' | 'E';

Element:
    AttributeBlock | VariableBlock | State | Transition | Fairness | Specification;

// ---------------------------------------------------------------------------
// Attributes (atoms) and their domains
// ---------------------------------------------------------------------------

AttributeBlock:
    'attributes' '{' (attributes+=Attribute)* '}';

Attribute:
    name=ID ':' type=AttributeType ';'?;

AttributeType:
    BooleanType | EnumType | RangeType;

BooleanType:
    {infer BooleanType} 'boolean';

EnumType:
    '{' values+=EnumValue (',' values+=EnumValue)* '}';

EnumValue:
    name=ID;

RangeType:
    low=SignedInt '..' high=SignedInt;

// ---------------------------------------------------------------------------
// Data variables: bounded counters and flags updated by transitions
//
//   variables { retries : 0..3 := 0; approved : boolean := FALSE; }
// ---------------------------------------------------------------------------

VariableBlock:
    'variables' '{' (variables+=Variable)* '}';

Variable:
    name=ID ':' type=AttributeType ':=' initial=AttributeValue ';'?;

// ---------------------------------------------------------------------------
// States, their labelling and their position on the drawing board
// ---------------------------------------------------------------------------

State:
    (initial?='initial')? 'state' name=ID (label=STRING)?
    ('{' (assignments+=Assignment (','? assignments+=Assignment)*)? '}')?
    ('at' '(' x=SignedInt ',' y=SignedInt ')')?
    ';'?;

Assignment:
    attribute=[Attribute:ID] '=' value=AttributeValue;

AttributeValue:
    {infer BooleanValue} value=('TRUE' | 'FALSE')
  | {infer IntegerValue} value=SignedInt
  | {infer SymbolValue} symbol=ID;

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

// s1 -> s2 : "label" when <guard> do v := <expr>, w := <expr> prob 0.8;
Transition:
    source=[State:ID] '->' target=[State:ID] (':' label=STRING)?
    ('when' guard=Expression)?
    ('do' updates+=Update (',' updates+=Update)*)?
    ('prob' probability=Probability)?
    ';'?;

Update:
    variable=[Variable:ID] ':=' value=Expression;

// ---------------------------------------------------------------------------
// Fairness constraints and specifications
// ---------------------------------------------------------------------------

Fairness:
    kind=('FAIRNESS' | 'JUSTICE') expression=Expression ';'?;

Specification:
    kind=('LTLSPEC' | 'CTLSPEC' | 'INVARSPEC') ('NAME' name=ID ':=')? expression=Expression ';'?;

// Expressions follow the nuXmv operator precedence (lowest first).
Expression:
    Implication;

Implication infers Expression:
    Equivalence ({infer BinaryExpression.left=current} operator='->' right=Implication)?;

Equivalence infers Expression:
    Disjunction ({infer BinaryExpression.left=current} operator='<->' right=Disjunction)*;

Disjunction infers Expression:
    Conjunction ({infer BinaryExpression.left=current} operator=('|' | 'xor' | 'xnor') right=Conjunction)*;

Conjunction infers Expression:
    TemporalBinary ({infer BinaryExpression.left=current} operator='&' right=TemporalBinary)*;

// U until, V release; past-time S since, T triggered.
TemporalBinary infers Expression:
    TemporalUnary ({infer BinaryExpression.left=current} operator=('U' | 'V' | 'S' | 'T') right=TemporalUnary)*;

// As in nuXmv, unary temporal operators take a whole comparison:
// F status = ready is F (status = ready). ! stays tight (!a = b is (!a) = b),
// except in front of a temporal operator: ! F p is !(F p).
TemporalUnary infers Expression:
    TemporalPrefixed
  | {infer UnaryExpression} operator='!' operand=TemporalPrefixed
  | Comparison;

TemporalPrefixed infers Expression:
    {infer UnaryExpression} operator=TemporalOperator operand=TemporalUnary;

Comparison infers Expression:
    Additive ({infer BinaryExpression.left=current} operator=('=' | '!=' | '<' | '>' | '<=' | '>=') right=Additive)*;

Additive infers Expression:
    Multiplicative ({infer BinaryExpression.left=current} operator=('+' | '-') right=Multiplicative)*;

Multiplicative infers Expression:
    Unary ({infer BinaryExpression.left=current} operator=('*' | '/' | 'mod') right=Unary)*;

Unary infers Expression:
    {infer UnaryExpression} operator=('!' | '-') operand=Unary
  | Primary;

// Future LTL (G F X), past LTL (Y previous, Z weak previous, H historically, O once), CTL.
TemporalOperator returns string:
    'G' | 'F' | 'X' | 'Y' | 'Z' | 'H' | 'O' | 'AG' | 'AF' | 'AX' | 'EG' | 'EF' | 'EX';

Primary infers Expression:
    '(' Expression ')'
  | {infer PathQuantifiedExpression} quantifier=('A' | 'E') '[' body=Expression ']'
  | {infer BooleanLiteral} value=('TRUE' | 'FALSE')
  | {infer NumberLiteral} value=INT
  | {infer StateVariable} 'state'
  | {infer NameReference} name=ID;

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

SignedInt returns number:
    '-'? INT;

Probability returns number:
    DECIMAL | INT;

hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w$#]*/;
terminal DECIMAL returns number: /[0-9]+\.[0-9]+/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /(\/\/|--)[^\n\r]*/;
