import{M as S,a as E,m as b,b as L}from"./motions_th-CPjySIZ-.js";import{TalkingHead as R}from"talkinghead";async function k({provider:e,apiKey:t,model:n,system:o,prompt:a}){if(!t)throw new Error(`API key required for ${e}`);if(!n)throw new Error(`Model required for ${e}`);if(e==="openai")return x(t,n,o,a);if(e==="gemini")return I(t,n,o,a);if(e==="claude")return $(t,n,o,a);throw new Error(`Unknown provider: ${e}`)}async function x(e,t,n,o){const a=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${e}`},body:JSON.stringify({model:t,messages:[{role:"system",content:n},{role:"user",content:o}],temperature:.7})});if(!a.ok)throw new Error(`OpenAI ${a.status}: ${await a.text()}`);return(await a.json()).choices[0].message.content}async function I(e,t,n,o){const a=`https://generativelanguage.googleapis.com/v1beta/models/${t}:generateContent?key=${e}`,i=await fetch(a,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system_instruction:{parts:[{text:n}]},contents:[{parts:[{text:o}]}],generationConfig:{temperature:.7}})});if(!i.ok)throw new Error(`Gemini ${i.status}: ${await i.text()}`);return(await i.json()).candidates[0].content.parts[0].text}async function $(e,t,n,o){const a=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":e,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:t,max_tokens:4096,system:n,messages:[{role:"user",content:o}],temperature:.7})});if(!a.ok)throw new Error(`Claude ${a.status}: ${await a.text()}`);return(await a.json()).content[0].text}function q(e){return`You are a motion designer for a 3D avatar. Given a natural-language description of a movement, you produce a JSON motion definition that the MotionEngine can play.

${e.getLLMContext()}

RULES:
- Respond with ONLY a valid JSON object — no markdown fences, no explanation.
- The JSON must follow this EXACT structure:
  {
    "dt": [fadeIn_ms, main_ms, fadeOut_ms],
    "rescale": [0, 1, 0],
    "vs": { "morphName": [value] },
    "_overlay": {
      "bones": { "BoneName": { "freq": hz, "amp": [x, y, z], "phase": radians } },
      "delay": ms,
      "duration": ms
    }
  }

FIELD DETAILS:
- "dt": array of durations in ms. Can have 3+ phases for complex sequences.
- "vs": maps morph target names to value arrays. Values 0–1.
- Special vs keys: "headRotateX/Y/Z", "bodyRotateX/Y/Z", "headMove", "chestInhale", "gesture".
- "gesture": [["poseName", null, isRight], null]. Poses: "handup", "thumbup", "thumbdown", "ok", "shrug", "namaste", "index", "side", "fist".
- "_overlay": top-level key. "freq": Hz, "amp": [x,y,z], "phase": radians.

EXAMPLES:

1. Hearty laugh (face + body overlay):
{"dt":[300,300,300,300,300,500],"vs":{"mouthSmile":[0.9],"mouthOpen":[0.3,0.5,0.3,0.5,0.3,0],"jawOpen":[0.2,0.4,0.2,0.4,0.2,0],"eyeSquintLeft":[0.8],"eyeSquintRight":[0.8],"cheekSquintLeft":[0.6],"cheekSquintRight":[0.6],"noseSneerLeft":[0.3],"noseSneerRight":[0.3],"bodyRotateX":[0.05,-0.02,0.05,-0.02,0.05,0]},"_overlay":{"bones":{"Spine":{"freq":10,"amp":[0.02,0,0.01]},"Head":{"freq":10,"amp":[0.01,0,0.01],"phase":1.5707963267948966}},"delay":200,"duration":1800}}

2. Sad expression (face + posture, no overlay):
{"dt":[800,2000,800],"rescale":[0,1,0],"vs":{"browInnerUp":[1],"eyeSquintLeft":[1],"eyeSquintRight":[1],"eyesClosed":[0.3],"mouthFrownLeft":[1],"mouthFrownRight":[1],"mouthPucker":[0.5],"bodyRotateX":[0.2,0.2,0],"headRotateX":[0.15,0.15,0]}}

3. Deep sigh (multi-phase breathing):
{"dt":[800,1200,500,1500,500],"rescale":[0,0,0,1,0],"vs":{"chestInhale":[0,0.8,0.8,0,0],"bodyRotateX":[0,-0.05,-0.05,0.15,0],"headRotateX":[0,-0.1,-0.1,0.15,0],"eyesClosed":[0,0.3,0.3,0.5,0],"mouthOpen":[0,0.2,0.2,0,0],"mouthFrownLeft":[0,0,0,0.6,0],"mouthFrownRight":[0,0,0,0.6,0],"browInnerUp":[0,0.3,0.3,0.7,0]}}

4. Wave with hand gesture + overlay:
{"dt":[300,2500,500],"rescale":[0,1,0],"vs":{"mouthSmile":[0.6],"eyeSquintLeft":[0.3],"eyeSquintRight":[0.3],"browInnerUp":[0.3],"gesture":[["handup",null,true],null]},"_overlay":{"bones":{"RightHand":{"freq":8,"amp":[0,0.12,0.12],"phase":0},"RightForeArm":{"freq":8,"amp":[0.04,0,0.08],"phase":1.5707963267948966}},"delay":400,"duration":2500}}

5. Shiver (high-freq subtle tremors):
{"dt":[300,2000,300],"rescale":[0,1,0],"vs":{"eyeSquintLeft":[0.4],"eyeSquintRight":[0.4],"mouthPressLeft":[0.3],"mouthPressRight":[0.3],"jawOpen":[0.1]},"_overlay":{"bones":{"Spine1":{"freq":18,"amp":[0.008,0,0.005],"phase":0},"Spine2":{"freq":18,"amp":[0.005,0,0.008],"phase":0.8},"Neck":{"freq":20,"amp":[0.004,0,0.004],"phase":1.2}},"delay":200,"duration":2200}}

6. Thinking (asymmetric face + head tilt, no overlay):
{"dt":[500,2000,500],"rescale":[0,1,0],"vs":{"browDownLeft":[1],"browOuterUpRight":[1],"eyeSquintLeft":[0.6],"mouthFrownLeft":[0.7],"mouthFrownRight":[0.7],"mouthRight":[0.5],"mouthRollLower":[0.5],"mouthPressRight":[0.4],"headRotateY":[0.15,0.15,0],"headRotateZ":[0.05,0.05,0],"bodyRotateY":[0.1,0.1,0]}}`}const C="./female_1.glb",O="F",g={openai:"gpt-5.2",gemini:"gemini-3.1-pro-preview",claude:"claude-opus-4-6"},A=document.getElementById("avatar-container"),m=document.getElementById("status"),h=document.getElementById("log"),P=document.getElementById("model-name"),c=document.getElementById("api-key"),y=document.getElementById("prompt-input"),w=document.getElementById("json-editor"),d=document.getElementById("btn-generate"),M=document.getElementById("btn-play"),N=document.getElementById("btn-stop"),v=document.querySelectorAll(".tab[data-provider]"),p=document.getElementById("presets");let u=null,s=null,f=null,l="gemini";function r(e,t="info"){const n=document.createElement("span");n.className=`log-${t}`,n.textContent=`[${new Date().toLocaleTimeString()}] ${e}
`,h.appendChild(n),h.scrollTop=h.scrollHeight}async function T(){r("Initializing TalkingHead...");const e=new(window.AudioContext||window.webkitAudioContext);u=new R(A,{audioCtx:e,showProgressBar:!1,dracoEnabled:!0,pcmSampleRate:16e3,cameraView:"full"}),await u.showAvatar({url:C,body:O,avatarMode:"full-body"}),u.start(),s=new S(u),f=new E(s);const t=s.registerMotions(b)+s.registerMotions(L);s.onStart=n=>{m.textContent=`Playing: ${n}`,r(`Playing: ${n}`)},s.onEnd=n=>{m.textContent="Ready.",r(`Finished: ${n}`)},s.onError=(n,o)=>{r(`Error: ${o.message}`,"warn")},u.opt.update=n=>s.update(n),r(`Registered ${t} custom motions.`),m.textContent="Ready. Describe a movement and generate!"}function B(e){l=e,v.forEach(t=>t.classList.toggle("active",t.dataset.provider===e)),P.textContent=g[e],c.value=localStorage.getItem(`llm-key-${e}`)||""}v.forEach(e=>{e.addEventListener("click",()=>B(e.dataset.provider))});c.addEventListener("input",()=>{localStorage.setItem(`llm-key-${l}`,c.value)});c.value=localStorage.getItem(`llm-key-${l}`)||"";p.addEventListener("change",()=>{p.value&&(y.value=p.value)});d.addEventListener("click",async()=>{const e=y.value.trim();if(e){if(!c.value.trim()){r("Please enter an API key.","error");return}d.disabled=!0,d.textContent="Generating...",r(`Sending to ${l} (${g[l]})...`);try{const t=q(f),n=await k({provider:l,apiKey:c.value.trim(),model:g[l],system:t,prompt:e});r("LLM responded.","info");let o=n.trim();const a=o.match(/```(?:json)?\s*([\s\S]*?)```/);a&&(o=a[1].trim());const i=JSON.parse(o);w.value=JSON.stringify(i,null,2),r("Motion JSON ready. Edit if needed, then Play.","info")}catch(t){r(`Generate failed: ${t.message}`,"error")}finally{d.disabled=!1,d.textContent="Generate Motion"}}});y.addEventListener("keydown",e=>{e.key==="Enter"&&(e.ctrlKey||e.metaKey)&&d.click()});M.addEventListener("click",async()=>{const e=w.value.trim();if(!e){r("No motion JSON to play.","warn");return}try{await f.playDynamic(e)}catch(t){t.name!=="AbortError"&&r(`Play error: ${t.message}`,"error")}});N.addEventListener("click",()=>{s.stop(),m.textContent="Stopped.",r("Stopped.","warn")});T().catch(e=>{r(`Init failed: ${e.message}`,"error"),m.textContent="Failed to load avatar."});
