const fs=require('fs'),path=require('path'),crypto=require('crypto');
const parser=require('/Users/tcuser/.npm/_npx/a1722018f28f9df2/node_modules/@babel/parser');
const prettier=require('/Users/tcuser/.npm/_npx/b388654678d519d9/node_modules/prettier');
(async()=>{
 const root=path.resolve(process.argv[2] || path.resolve(__dirname,'..')),source='recovered/chunk-wvsyb4fb.js';
 const code=fs.readFileSync(path.join(root,source),'utf8');
 const ast=parser.parse(code,{sourceType:'module',plugins:['explicitResourceManagement','importAttributes']});
 const start=ast.program.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(x=>x.id.name==='uXe')).start;
 const end=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='Zwe').end;
 const body=code.slice(start,end), bytes=Buffer.from(body), byteStart=Buffer.byteLength(code.slice(0,start));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'evidence/extraction-manifest.json')));
 const parent=manifest.records.find(r=>r.extracted_path===source);
 const raw='compact-extra-focus/prompt-template-bundle.js',readable='compact-extra-readable/prompt-template-bundle.js';
 fs.writeFileSync(path.join(root,raw),bytes);
 fs.writeFileSync(path.join(root,readable),'// Shipped prompt data and functions, for static reading only. Do not execute.\n'+await prettier.format(body,{parser:'babel',printWidth:100}));
 const out={binary_sha256:manifest.binary_sha256,records:[{label:'prompt templates and variant selection',source,source_sha256:parent.sha256,source_byte_start:byteStart,source_byte_length:bytes.length,binary_file_offset:parent.content_file_offset+byteStart,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),raw_path:raw,readable_path:readable}]};
 fs.writeFileSync(path.join(root,'evidence/compact-prompt-manifest.json'),JSON.stringify(out,null,2));
 console.log('Extracted shipped prompt section, '+bytes.length+' bytes.');
})();
