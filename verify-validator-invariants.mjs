import { validateReport } from '../takaven-project-auditor/src/core.mjs';
const base={project:'p',commit:'c',verdict:'CONTINUE',executive_summary:'s',runtime_status:'NOT RUN',
  runtime_evidence:[],findings:[],reuse_assessment:[],commercial_risks:[],unverified:[],next_actions:[]};
const good={...base,runtime_status:'PASS',runtime_evidence:[{check:'boot',status:'PASS',command:'npm start',observation:'rendered',negative_control:'broke token, went red'}]};

const cases=[
  ['UNEARNED PASS (empty evidence)',       {...base,runtime_status:'PASS'},            'verify', false],
  ['UNEARNED FAIL (empty evidence)',       {...base,runtime_status:'FAIL'},            'verify', false],
  ['inspect mode claiming PASS',           good,                                        'inspect',false],
  ['evidence items as strings',            {...base,runtime_evidence:['it booted']},   'verify', false],
  ['finding missing severity',             {...base,findings:[{title:'x'}]},           'verify', false],
  ['OBSERVED finding, no evidence',        {...base,findings:[{title:'t',severity:'HIGH',evidence_type:'OBSERVED',evidence:'e',location:'l',recommended_fix:'f'}]},'verify',false],
  ['bad severity value',                   {...base,findings:[{title:'t',severity:'SEVERE',evidence_type:'OBSERVED',evidence:'e',location:'l',recommended_fix:'f'}]},'verify',false],
  ['LEGITIMATE pass with evidence',        good,                                        'verify', true ],
  ['LEGITIMATE inspect NOT RUN',           base,                                        'inspect',true ],
];
let bad=0;
for (const [label,report,mode,shouldPass] of cases){
  let passed=true,msg='';
  try{ validateReport(report,mode); }catch(e){ passed=false; msg=e.message; }
  const ok = passed===shouldPass;
  if(!ok) bad++;
  console.log(`${ok?'  ok  ':'FAIL!!'} ${shouldPass?'accept':'reject'}: ${label}${passed?'':'  <- '+msg.slice(0,70)}`);
}
console.log(bad? `\n${bad} CASE(S) WRONG` : '\nall 9 behave correctly');
