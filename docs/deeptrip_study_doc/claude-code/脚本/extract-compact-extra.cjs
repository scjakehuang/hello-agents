// Parse shipped JavaScript as data; never import/execute the analysis target.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const parser=require('/Users/tcuser/.npm/_npx/a1722018f28f9df2/node_modules/@babel/parser');
const prettier=require('/Users/tcuser/.npm/_npx/b388654678d519d9/node_modules/prettier');
const root=path.resolve(process.argv[2] || path.resolve(__dirname,'..'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'evidence/extraction-manifest.json')));
const selection={
 'chunk-wvsyb4fb.js':['QQ','BYe','HYe','VX','aTr','qf','PYe','Og','F1e','Ien','h8e','EBe','Cur','Z4o','dbo'],
 'chunk-pxqq6s5v.js':['Qc','J9n','wl','El','JFo','KKs','qKs','mr'],
 'chunk-jk32x8c1.js':['Ale','H9','Q','Kmt','j','ae'],
 'chunk-2zjx6xpn.js':['G','P'],
 'chunk-e853mz9g.js':['Bh']
};
(async()=>{let records=[];
 for(const [file,names] of Object.entries(selection)){
  const raw=fs.readFileSync(path.join(root,'recovered',file),'utf8');
  const ast=parser.parse(raw,{sourceType:'module',plugins:['explicitResourceManagement','importAttributes']});
  const parent=manifest.records.find(r=>r.extracted_path==='recovered/'+file);
  const wanted=new Set(names);let found=new Set();
  for(const n of ast.program.body){if(n.type!=='FunctionDeclaration'||!wanted.has(n.id?.name))continue;
   found.add(n.id.name);const body=raw.slice(n.start,n.end),bytes=Buffer.from(body);
   const start=Buffer.byteLength(raw.slice(0,n.start)),stem=file.replace(/\.js$/,'')+'__'+n.id.name;
   fs.mkdirSync(path.join(root,'compact-extra-focus'),{recursive:true});
   fs.mkdirSync(path.join(root,'compact-extra-readable'),{recursive:true});
   const out='compact-extra-focus/'+stem+'.js',formatted='compact-extra-readable/'+stem+'.js';
   fs.writeFileSync(path.join(root,out),bytes);
   const header='// Claude Code 2.1.307 shipped function excerpt; original symbol names.\n// Source: '+file+'; binary file offset '+(parent.content_file_offset+start)+'.\n// External bindings/constants are not included. For reading only; not a runnable standalone module.\n';
   fs.writeFileSync(path.join(root,formatted),header+await prettier.format(body,{parser:'babel',printWidth:100}));
   records.push({function:n.id.name,source:'recovered/'+file,source_sha256:parent.sha256,source_byte_start:start,source_byte_length:bytes.length,binary_file_offset:parent.content_file_offset+start,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),raw_path:out,readable_path:formatted});
  }
  const missing=names.filter(n=>!found.has(n));if(missing.length)console.log('Not found in '+file+': '+missing.join(','));
 }
 const result={binary_sha256:manifest.binary_sha256,description:'Exact shipped function body slices. External bindings absent; all static graphs are partial; readable derivatives only change formatting and add provenance comments.',records};
 fs.writeFileSync(path.join(root,'evidence/compact-extra-functions-manifest.json'),JSON.stringify(result,null,2));
 console.log('Extracted '+records.length+' functions.');
})();
