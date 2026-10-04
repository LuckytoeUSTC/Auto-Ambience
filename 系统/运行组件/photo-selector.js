(() => {
 const photo=document.getElementById('photo'), image=document.getElementById('photo-image'), toggle=document.getElementById('photo-open'), picker=document.getElementById('photo-picker');
 let busy=false, generation=0, names=[], selected='', page=0;
 const source=name=>'/_photo?name='+encodeURIComponent(name);
 const grid=document.createElement('div');grid.className='photo-grid';
 const controls=document.createElement('div');controls.className='photo-pages';
 const count=document.createElement('span');count.className='photo-page-count';
 function arrow(direction,label,path){const button=document.createElement('button');button.type='button';button.className='photo-page-arrow';button.setAttribute('aria-label',label);button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+path+'"/></svg>';button.addEventListener('click',()=>{if(!busy){page+=direction;render();}});return button;}
 const up=arrow(-1,'上一页','M12 20V4M5 11l7-7 7 7'),down=arrow(1,'下一页','M12 4v16M5 13l7 7 7-7');controls.append(count,up,down);picker.replaceChildren(grid,controls);
 function render(){
  const total=Math.max(1,Math.ceil(names.length/6));page=Math.max(0,Math.min(page,total-1));count.textContent=(page+1)+'/'+total;up.disabled=busy||page===0;down.disabled=busy||page===total-1;
  grid.replaceChildren(...names.slice(page*6,page*6+6).map(name=>{
   const button=document.createElement('button');button.type='button';button.className='photo-option';button.dataset.name=name;button.disabled=busy;button.setAttribute('aria-pressed',String(name===selected));
   const thumbnail=document.createElement('img');thumbnail.src=source(name);thumbnail.alt='';
   const label=document.createElement('span');label.textContent=name;button.append(thumbnail,label);return button;
  }));
 }
 function close(){if(busy)return;generation++;picker.hidden=true;toggle.setAttribute('aria-expanded','false');window.autoAmbiencePhotoMenuOpen=false;}
 function failure(error){toggle.dataset.error='true';toggle.setAttribute('aria-label','照片操作失败');console.error(error);}
 toggle.addEventListener('click',async()=>{
  if(busy)return;if(!picker.hidden)return close();
  delete toggle.dataset.error;toggle.setAttribute('aria-label','选择照片');picker.hidden=false;toggle.setAttribute('aria-expanded','true');window.autoAmbiencePhotoMenuOpen=true;grid.replaceChildren();count.textContent='';up.disabled=down.disabled=true;
  const request=++generation;
  try{const response=await fetch('/_photos');if(!response.ok)throw Error(await response.text());const data=await response.json();if(request!==generation)return;names=data.names;selected=data.selected;page=Math.floor(Math.max(0,names.indexOf(selected))/6);render();}catch(error){if(request===generation)failure(error);}
 });
 grid.addEventListener('click',async event=>{
  const button=event.target.closest('.photo-option');if(!button||busy||button.dataset.name===selected)return;
  busy=true;grid.querySelectorAll('button').forEach(item=>item.disabled=true);up.disabled=down.disabled=true;
  try{const preview=new Image();preview.src=source(button.dataset.name);await preview.decode();const response=await fetch('/_photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:button.dataset.name})});if(!response.ok)throw Error(await response.text());image.src=preview.src;selected=button.dataset.name;delete toggle.dataset.error;toggle.setAttribute('aria-label','选择照片');}catch(error){failure(error);}finally{busy=false;render();}
 });
 photo.addEventListener('pointerdown',event=>{if(event.target.closest('#photo-picker, #photo-open'))event.stopPropagation();});
 document.addEventListener('click',event=>{if(!photo.contains(event.target))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
})();
