const stateMenu=document.getElementById('state-menu');
const stateOptions=document.getElementById('state-options');
const stateMessage=document.getElementById('state-message');
let stateChanged=false;
window.autoAmbienceStateMenuOpen=false;
function drawStateItems(items){
  stateOptions.replaceChildren();
  for(const item of items){
    const row=document.createElement('button');
    row.type='button';row.className='state-option';
    row.setAttribute('aria-pressed',String(item.selected));
    row.textContent=item.label;
    row.addEventListener('click',async()=>{
      row.disabled=true;
      try{
        const response=await fetch('/_state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index:item.index,label:item.label,selected:!item.selected})});
        if(!response.ok)throw Error(await response.text());
        stateChanged=true;drawStateItems(await response.json());stateMessage.textContent='已保存到 Markdown';
      }catch(error){stateMessage.textContent='保存失败：'+error.message;row.disabled=false}
    });
    stateOptions.append(row);
  }
}
document.getElementById('state-open').addEventListener('click',async()=>{
  try{
    const response=await fetch('/_state',{cache:'no-store'});
    if(!response.ok)throw Error(await response.text());
    drawStateItems(await response.json());stateMessage.textContent='单击切换 · 自动保存';
    stateChanged=false;stateMenu.hidden=false;window.autoAmbienceStateMenuOpen=true;
  }catch(error){console.error('读取此在关键词失败',error)}
});
function closeStateMenu(){stateMenu.hidden=true;window.autoAmbienceStateMenuOpen=false;if(stateChanged)location.reload()}
document.getElementById('state-close').addEventListener('click',closeStateMenu);
document.getElementById('state-done').addEventListener('click',closeStateMenu);
stateMenu.addEventListener('click',event=>{if(event.target===stateMenu)closeStateMenu()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!stateMenu.hidden)closeStateMenu()});

