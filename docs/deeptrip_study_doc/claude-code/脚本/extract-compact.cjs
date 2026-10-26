// Parse shipped JavaScript as data; never import/execute the analysis target.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const parser=require('/Users/tcuser/.npm/_npx/a1722018f28f9df2/node_modules/@babel/parser');
const prettier=require('/Users/tcuser/.npm/_npx/b388654678d519d9/node_modules/prettier');
const root=path.resolve(process.argv[2] || path.resolve(__dirname,'..'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'evidence/extraction-manifest.json')));
const selection={
 'chunk-wvsyb4fb.js':['mb','t4e','Az','lme','I5t','a2','gpt','edn','Tur','Fve','$ve','xur','Pur','tdn','pXe','Jln','Xwe','Zwe','Ywe','fur','QZ','hur','Qwe','vur','hcn','SXe','$ln','jln','Kwe','qwe','QRr','jRr','H1','Yve','sfr','afr','ffr','ccn','exr','CWn','gvo','_fr','Ncn','lTr','Ocn','jve','nfr','ofr','ucn','E7e','HR','$cr','Evo','nxr','kvo'],
 'chunk-s7k1n636.js':['C4r','Ar','Ut'],
 'chunk-ywba0mfz.js':['ff','tN']
};
(async()=>{let records=[];
 for(const [file,names] of Object.entries(selection)){
  const raw=fs.readFileSync(path.join(root,'recovered',file),'utf8');
  const ast=parser.parse(raw,{sourceType:'module',plugins:['explicitResourceManagement','importAttributes']});
  const parent=manifest.records.find(r=>r.extracted_path==='recovered/'+file);
  const wanted=new Set(names);let found=new Set();
  for(const n of ast.program.body){if(n.type!=='FunctionDeclaration'||!wanted.has(n.id?.name))continue;
   found.add(n.id.name);const body=raw.slice(n.start,n.end),bytes=Buffer.from(body);
   const start=Buffer.byteLength(raw.slice(0,n.start)),stem=file.replace(/\.js$/,'')+'__'+n.id.name+(['qwe','Qwe','jln','Jln'].includes(n.id.name)?'--'+Buffer.from(n.id.name).toString('hex'):'');
   fs.mkdirSync(path.join(root,'compact-export-focus'),{recursive:true});
   fs.mkdirSync(path.join(root,'compact-export-readable'),{recursive:true});
   const out='compact-export-focus/'+stem+'.js',formatted='compact-export-readable/'+stem+'.js';
   fs.writeFileSync(path.join(root,out),bytes);
   const header='// Claude Code 2.1.307 shipped function excerpt; original symbol names.\n// Source: '+file+'; binary file offset '+(parent.content_file_offset+start)+'.\n// External bindings/constants are not included. For reading only; not a runnable standalone module.\n';
   fs.writeFileSync(path.join(root,formatted),header+await prettier.format(body,{parser:'babel',printWidth:100}));
   records.push({function:n.id.name,source:'recovered/'+file,source_sha256:parent.sha256,source_byte_start:start,source_byte_length:bytes.length,binary_file_offset:parent.content_file_offset+start,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),raw_path:out,readable_path:formatted});
  }
  const missing=names.filter(n=>!found.has(n));if(missing.length)console.log('Not found in '+file+': '+missing.join(','));
 }
 const result={binary_sha256:manifest.binary_sha256,description:'Exact shipped function body slices. External bindings absent; all static graphs are partial; readable derivatives only change formatting and add provenance comments.',records};
 fs.writeFileSync(path.join(root,'evidence/compact-export-functions-manifest.json'),JSON.stringify(result,null,2));
 console.log('Extracted '+records.length+' functions.');
})();
