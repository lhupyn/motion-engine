import{M as S,m as E,a as b}from"./motions_th-8X-AKvCI.js";import{TalkingHead as L}from"talkinghead";import{M as R}from"./MotionStudio-Dam6Ny3Q.js";async function k({provider:e,apiKey:t,model:n,system:a,prompt:i}){if(!t)throw new Error(`API key required for ${e}`);if(!n)throw new Error(`Model required for ${e}`);if(e==="gemini")return I(t,n,a,i);throw new Error(`Unknown provider: ${e}`)}async function I(e,t,n,a){const i=`https://generativelanguage.googleapis.com/v1beta/models/${t}:generateContent?key=${e}`,l=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({system_instruction:{parts:[{text:n}]},contents:[{parts:[{text:a}]}],generationConfig:{temperature:.7}})});if(!l.ok)throw new Error(`Gemini ${l.status}: ${await l.text()}`);return(await l.json()).candidates[0].content.parts[0].text}function x(e){return`You are a motion designer for a 3D avatar. Given a natural-language description of a movement, you produce a JSON motion definition that the MotionEngine can play.

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
{"dt":[500,2000,500],"rescale":[0,1,0],"vs":{"browDownLeft":[1],"browOuterUpRight":[1],"eyeSquintLeft":[0.6],"mouthFrownLeft":[0.7],"mouthFrownRight":[0.7],"mouthRight":[0.5],"mouthRollLower":[0.5],"mouthPressRight":[0.4],"headRotateY":[0.15,0.15,0],"headRotateZ":[0.05,0.05,0],"bodyRotateY":[0.1,0.1,0]}}`}const q="./female_1.glb",$="F",y={gemini:"gemini-3.1-pro-preview"},C=document.getElementById("avatar-container"),c=document.getElementById("status"),h=document.getElementById("log"),M=document.getElementById("model-name"),m=document.getElementById("api-key"),g=document.getElementById("prompt-input"),v=document.getElementById("json-editor"),d=document.getElementById("btn-generate"),O=document.getElementById("btn-play"),A=document.getElementById("btn-stop"),w=document.querySelectorAll(".tab[data-provider]"),p=document.getElementById("presets");let u=null,r=null,f=null,s="gemini";function o(e,t="info"){const n=document.createElement("span");n.className=`log-${t}`,n.textContent=`[${new Date().toLocaleTimeString()}] ${e}
`,h.appendChild(n),h.scrollTop=h.scrollHeight}async function P(){o("Initializing TalkingHead...");const e=new(window.AudioContext||window.webkitAudioContext);u=new L(C,{audioCtx:e,showProgressBar:!1,dracoEnabled:!0,pcmSampleRate:16e3,cameraView:"full"}),await u.showAvatar({url:q,body:$,avatarMode:"full-body"}),u.start(),r=new S(u),f=new R(r);const t=r.registerMotions(E)+r.registerMotions(b);r.onStart=n=>{c.textContent=`Playing: ${n}`,o(`Playing: ${n}`)},r.onEnd=n=>{c.textContent="Ready.",o(`Finished: ${n}`)},r.onError=(n,a)=>{o(`Error: ${a.message}`,"warn")},u.opt.update=n=>r.update(n),o(`Registered ${t} custom motions.`),c.textContent="Ready. Describe a movement and generate!"}function N(e){s=e,w.forEach(t=>t.classList.toggle("active",t.dataset.provider===e)),M.textContent=y[e],m.value=localStorage.getItem(`llm-key-${e}`)||""}w.forEach(e=>{e.addEventListener("click",()=>N(e.dataset.provider))});m.addEventListener("input",()=>{localStorage.setItem(`llm-key-${s}`,m.value)});m.value=localStorage.getItem(`llm-key-${s}`)||"";p.addEventListener("change",()=>{p.value&&(g.value=p.value)});d.addEventListener("click",async()=>{const e=g.value.trim();if(e){if(!m.value.trim()){o("Please enter an API key.","error");return}d.disabled=!0,d.textContent="Generating...",o(`Sending to ${s} (${y[s]})...`);try{const t=x(f),n=await k({provider:s,apiKey:m.value.trim(),model:y[s],system:t,prompt:e});o("LLM responded.","info");let a=n.trim();const i=a.match(/```(?:json)?\s*([\s\S]*?)```/);i&&(a=i[1].trim());const l=JSON.parse(a);v.value=JSON.stringify(l,null,2),o("Motion JSON ready. Edit if needed, then Play.","info")}catch(t){o(`Generate failed: ${t.message}`,"error")}finally{d.disabled=!1,d.textContent="Generate Motion"}}});g.addEventListener("keydown",e=>{e.key==="Enter"&&(e.ctrlKey||e.metaKey)&&d.click()});O.addEventListener("click",async()=>{const e=v.value.trim();if(!e){o("No motion JSON to play.","warn");return}try{await f.playDynamic(e)}catch(t){t.name!=="AbortError"&&o(`Play error: ${t.message}`,"error")}});A.addEventListener("click",()=>{r.stop(),c.textContent="Stopped.",o("Stopped.","warn")});P().catch(e=>{o(`Init failed: ${e.message}`,"error"),c.textContent="Failed to load avatar."});
