// Extract static JS/TS imports (including CommonJS) without running product modules.
const fs=require('node:fs'),ts=require('typescript');
const files=JSON.parse(fs.readFileSync(0,'utf8'));
const imports={};
for(const file of files){
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const specifiers=new Set();
  function visit(node){
    let specifier;
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))specifier=node.moduleSpecifier;
    else if(ts.isExternalModuleReference(node))specifier=node.expression;
    else if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))specifier=node.argument.literal;
    else if(ts.isCallExpression(node)&&node.arguments.length){
      const expr=node.expression;
      if(expr.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(expr)&&expr.text==='require')||
        (ts.isPropertyAccessExpression(expr)&&expr.expression.getText(source)==='require'&&expr.name.text==='resolve')){
        specifier=node.arguments[0];
      }
    }
    if(specifier&&ts.isStringLiteralLike(specifier))specifiers.add(specifier.text);
    ts.forEachChild(node,visit);
  }
  visit(source);
  imports[file]=[...specifiers];
}
console.log(JSON.stringify(imports));
