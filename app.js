(() => {
  'use strict';
  const config = window.VENTA_CONFIG || {};
  const grid = document.getElementById('product-grid');
  const inventoryCount = document.getElementById('inventory-count');
  const errorBanner = document.getElementById('error-banner');
  const noResults = document.getElementById('no-results');
  const search = document.getElementById('search');
  const filter = document.getElementById('status-filter');
  const sort = document.getElementById('sort-filter');
  const symbolByCategory = {
    'Hogar': '⌂', 'Decoración': '✿', 'Ropa y accesorios': '✧', 'Arte y manualidades': '✎', 'Juegos': '◎', 'Otros': '✦'
  };
  const colors = ['#eee8dc','#e9ebe3','#f0e8e3','#e9eae5','#ebe7dc','#ebeee8'];
  let products = [];
  let sheetNotConnected = false;
  const currency = new Intl.NumberFormat('es-CO', {style:'currency',currency:'COP',maximumFractionDigits:0});
  const clean = (value) => String(value == null ? '' : value).trim();
  const normalize = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const sold = (value) => ['vendido','vendida','agotado','agotada','si','sí','true','1'].includes(normalize(value));
  const whatsapp = clean(config.whatsapp).replace(/\D/g,'') || '573226630163';
  const messageLink = (p) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, estoy interesado en comprar este artículo: ${p.nombre}. ¿Está disponible?`)}`;
  for (const el of [document.getElementById('top-whatsapp'), document.getElementById('bottom-whatsapp')]) {
    el.href = `https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, vi tu venta de garaje y quiero hacer una consulta.')}`;
  }

  const sanitizeImage = (value) => {
    const str = clean(value);
    if (!str) return '';
    // Permitimos imágenes locales y enlaces HTTPS, nunca javascript:/data:.
    if (/^https:\/\//i.test(str)) return str;
    if (/^(?:\.\/)?imagenes\/[a-z0-9_.-]+\.(png|jpe?g|webp|avif|gif)$/i.test(str)) return str;
    return '';
  };

  const normalizeProducts = (raw) => raw.map((p,i) => ({
      id: clean(p.id) || String(i+1),
      nombre: clean(p.nombre) || `Artículo ${i+1}`,
      precio: Number(String(p.precio ?? 0).replace(/[^0-9]/g,'')) || 0,
      categoria: clean(p.categoria) || 'Otros',
      descripcion: clean(p.descripcion),
      imagen: sanitizeImage(p.imagen),
      fotos: Array.isArray(p.fotos) ? p.fotos.map(sanitizeImage).filter(Boolean) : [],
      vendido: sold(p.estado)
    })).filter(p => p.nombre);

  async function loadFromGoogleSheet(sheetId, sheetGid) {
    if (!/^[\w-]{20,}$/.test(sheetId)) throw new Error('ID de Google Sheets inválido');
    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
    url.searchParams.set('tqx','out:json');
    url.searchParams.set('headers','1');
    url.searchParams.set('gid',sheetGid || '0');
    url.searchParams.set('_',Date.now());
    const res = await fetch(url.toString(),{cache:'no-store'});
    if(!res.ok) throw new Error(`No se pudo consultar la hoja (${res.status})`);
    const body = await res.text();
    const a=body.indexOf('{'), b=body.lastIndexOf('}');
    if (a<0 || b<=a) throw new Error('Formato desconocido de Google Sheets');
    const json=JSON.parse(body.slice(a,b+1));
    if(json.status !== 'ok' || !json.table) throw new Error('Hoja no pública o no disponible');
    const names=(json.table.cols || []).map((col,i)=>normalize(col.label || col.id || `col${i}`));
    const cols=['id','nombre','precio','categoria','descripcion','imagen','estado'];
    const indices=cols.map(name=>names.indexOf(name));
    if(indices[1]===-1 || indices[2]===-1 || indices[6]===-1) throw new Error('Faltan columnas: nombre, precio o estado');
    return (json.table.rows || []).map(row=>{
      const obj={};
      cols.forEach((name,i)=>{
        const cell=row.c?.[indices[i]];
        obj[name]=indices[i]<0 ? '' : (cell?.v ?? '');
      });
      return obj;
    });
  }
  async function loadLocalProducts() {
    const res=await fetch('./productos.json',{cache:'no-store'});
    if(!res.ok) throw new Error('No se encontró el inventario local');
    return await res.json();
  }

  function mergeProducts(localRaw, remoteRaw) {
    const local=normalizeProducts(localRaw);
    if (!remoteRaw || !remoteRaw.length) return local;
    const remote=normalizeProducts(remoteRaw);
    const remoteById=new Map(remote.map(item=>[item.id,item]));
    const merged=local.map(item=>{
      const extra=remoteById.get(item.id);
      return extra ? { ...item, ...extra, imagen: item.imagen || extra.imagen, fotos: item.fotos.length ? item.fotos : extra.fotos } : item;
    });
    for (const item of remote) {
      if (!merged.some(existing => existing.id === item.id)) merged.push(item);
    }
    return merged;
  }

  async function loadProducts() {
    grid.setAttribute('aria-busy','true');
    errorBanner.hidden=true;
    noResults.hidden=true;
    try {
      const localRaw = await loadLocalProducts();
      let remoteRaw = [];
      sheetNotConnected = false;
      if (clean(config.googleSheetId)) {
        try {
          remoteRaw = await loadFromGoogleSheet(clean(config.googleSheetId),clean(config.googleSheetGid));
        } catch(err) {
          console.warn('No se pudo consultar Google Sheets; se usará el catálogo local.', err);
          sheetNotConnected = true;
        }
      }
      products = mergeProducts(localRaw, remoteRaw);
      errorBanner.hidden = !sheetNotConnected;
      if (sheetNotConnected) {
        errorBanner.querySelector('strong').textContent = 'Confirma disponibilidad por WhatsApp';
        errorBanner.querySelector('span').textContent = 'Mostramos las fotos y precios, pero no pudimos consultar los estados actualizados de Google Sheets.';
      }
      render();
    } catch(err) {
      console.error('Error al cargar el inventario:',err);
      products=[];
      grid.replaceChildren();
      inventoryCount.textContent='Catálogo temporalmente no disponible';
      errorBanner.hidden=false;
    } finally {
      grid.setAttribute('aria-busy','false');
    }
  }


  // Visor accesible con zoom táctil (pinza), rueda, arrastre y controles.
  const viewer = document.getElementById('image-viewer');
  const viewerStage = document.getElementById('viewer-stage');
  const viewerImage = document.getElementById('viewer-image');
  const viewerTitle = document.getElementById('image-viewer-title');
  const viewerLevel = document.getElementById('viewer-zoom-level');
  const viewerClose = document.getElementById('viewer-close');
  let zoom = 1, panX = 0, panY = 0;
  let previousFocus = null, lockedScroll = 0;
  const activePointers = new Map();
  const limit = (n,min,max) => Math.min(max,Math.max(min,n));
  const maxZoom = 5;

  function clampPan() {
    if (zoom <= 1) { panX=0; panY=0; return; }
    const maxX = Math.max(0,(viewerImage.offsetWidth*zoom-viewerStage.clientWidth)/2);
    const maxY = Math.max(0,(viewerImage.offsetHeight*zoom-viewerStage.clientHeight)/2);
    panX = limit(panX,-maxX,maxX);
    panY = limit(panY,-maxY,maxY);
  }
  function renderZoom() {
    clampPan();
    viewerImage.style.transform = 'translate3d('+panX+'px,'+panY+'px,0) scale('+zoom+')';
    viewerLevel.textContent = Math.round(zoom*100)+' %';
    document.getElementById('viewer-zoom-out').disabled = zoom <= 1;
    document.getElementById('viewer-zoom-in').disabled = zoom >= maxZoom;
  }
  function setZoom(next) {
    zoom = limit(next,1,maxZoom);
    renderZoom();
  }

  const galleryControls = document.getElementById('viewer-gallery-controls');
  const galleryThumbs = document.getElementById('viewer-thumbnails');
  const photoNumber = document.getElementById('viewer-photo-count');
  const previousPhoto = document.getElementById('viewer-prev');
  const nextPhoto = document.getElementById('viewer-next');
  let viewerPhotos = [];
  let viewerPhotoIndex = 0;
  let viewerProductName = '';
  let swipeOriginX = null;

  function galleryOf(product) {
    const photoList = [product.imagen,...(product.fotos || [])].filter(Boolean);
    return [...new Set(photoList)];
  }
  function changeViewerPhoto(index) {
    if (!viewerPhotos.length) return;
    viewerPhotoIndex = (index + viewerPhotos.length) % viewerPhotos.length;
    viewerImage.src = viewerPhotos[viewerPhotoIndex];
    viewerImage.alt = 'Fotografía '+(viewerPhotoIndex+1)+' de '+viewerPhotos.length+': '+viewerProductName;
    photoNumber.textContent = (viewerPhotoIndex+1)+' de '+viewerPhotos.length;
    galleryThumbs.querySelectorAll('button').forEach((button,i)=>{
      const selected=i===viewerPhotoIndex;
      button.classList.toggle('is-selected',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    zoom=1;panX=0;panY=0;renderZoom();
  }
  function openViewer(product) {
    if (!product.imagen) return;
    previousFocus = document.activeElement;
    lockedScroll = window.scrollY;
    viewerPhotos = galleryOf(product);
    viewerPhotoIndex = 0;
    viewerProductName = product.nombre;
    viewerTitle.textContent = product.nombre;
    const multiple = viewerPhotos.length>1;
    galleryControls.hidden = !multiple;
    galleryThumbs.hidden = !multiple;
    galleryThumbs.replaceChildren();
    if(multiple){
      viewerPhotos.forEach((src,i)=>{
        const button=document.createElement('button');
        button.type='button';
        button.className='viewer-thumb';
        button.setAttribute('aria-label','Ver foto '+(i+1)+' de '+viewerPhotos.length);
        const thumbnail=document.createElement('img');
        thumbnail.src=src;thumbnail.alt='';thumbnail.loading='lazy';
        button.append(thumbnail);
        button.addEventListener('click',()=>changeViewerPhoto(i));
        galleryThumbs.append(button);
      });
    }
    viewer.hidden = false;
    document.body.classList.add('viewer-open');
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + lockedScroll + 'px';
    document.body.style.width = '100%';
    activePointers.clear();
    changeViewerPhoto(0);
    viewerClose.focus({preventScroll:true});
  }
  function closeViewer() {
    if (viewer.hidden) return;
    viewer.hidden = true;
    viewerImage.removeAttribute('src');
    activePointers.clear();
    document.body.classList.remove('viewer-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0,lockedScroll);
    if (previousFocus && previousFocus.isConnected) previousFocus.focus({preventScroll:true});
  }
  viewerImage.addEventListener('load',renderZoom);
  viewerClose.addEventListener('click',closeViewer);
  previousPhoto.addEventListener('click',()=>changeViewerPhoto(viewerPhotoIndex-1));
  nextPhoto.addEventListener('click',()=>changeViewerPhoto(viewerPhotoIndex+1));
  document.getElementById('viewer-zoom-in').addEventListener('click',()=>setZoom(zoom*1.5));
  document.getElementById('viewer-zoom-out').addEventListener('click',()=>setZoom(zoom/1.5));
  document.getElementById('viewer-zoom-reset').addEventListener('click',()=>setZoom(1));
  viewer.addEventListener('click',(e)=>{if(e.target===viewer)closeViewer()});
  document.addEventListener('keydown',(e)=>{
    if(viewer.hidden)return;
    if(e.key==='Escape'){e.preventDefault();closeViewer();return;}
    if(e.key==='ArrowLeft' && viewerPhotos.length>1){e.preventDefault();changeViewerPhoto(viewerPhotoIndex-1);return;}
    if(e.key==='ArrowRight' && viewerPhotos.length>1){e.preventDefault();changeViewerPhoto(viewerPhotoIndex+1);return;}
    if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(zoom*1.5);}
    if(e.key==='-'){e.preventDefault();setZoom(zoom/1.5);}
    if(e.key==='0'){e.preventDefault();setZoom(1);}
    if(e.key==='Tab'){
      const list=Array.from(viewer.querySelectorAll('button:not([disabled])'));
      const current=list.indexOf(document.activeElement);
      if(e.shiftKey && (current===0 || current===-1)){e.preventDefault();list[list.length-1].focus();}
      else if(!e.shiftKey && (current===list.length-1 || current===-1)){e.preventDefault();list[0].focus();}
    }
  });
  viewerStage.addEventListener('wheel',(e)=>{
    if(viewer.hidden)return;
    e.preventDefault();
    setZoom(zoom*(e.deltaY<0?1.15:1/1.15));
  },{passive:false});
  viewerStage.addEventListener('dblclick',()=>setZoom(zoom>1?1:2));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  viewerStage.addEventListener('pointerdown',(e)=>{
    if(viewer.hidden)return;
    e.preventDefault();
    viewerStage.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(activePointers.size===1){viewerStage.classList.add('is-dragging');swipeOriginX=e.clientX;}
    if(activePointers.size>1)swipeOriginX=null;
  });
  viewerStage.addEventListener('pointermove',(e)=>{
    if(!activePointers.has(e.pointerId))return;
    e.preventDefault();
    const old=Array.from(activePointers.values());
    activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const now=Array.from(activePointers.values());
    if(now.length===1 && zoom>1){panX+=now[0].x-old[0].x;panY+=now[0].y-old[0].y;}
    else if(now.length===2 && old.length===2){
      const prevDist=distance(old[0],old[1]);
      const nextDist=distance(now[0],now[1]);
      if(prevDist>0)zoom=limit(zoom*nextDist/prevDist,1,maxZoom);
      const prevMid=midpoint(old[0],old[1]), nextMid=midpoint(now[0],now[1]);
      panX+=nextMid.x-prevMid.x;panY+=nextMid.y-prevMid.y;
    }
    renderZoom();
  });
  function endPointer(e){
    if (activePointers.size===1 && swipeOriginX!==null && zoom<=1 && viewerPhotos.length>1 && e.type==='pointerup') {
      const delta=e.clientX-swipeOriginX;
      if(Math.abs(delta)>65)changeViewerPhoto(viewerPhotoIndex+(delta<0?1:-1));
    }
    activePointers.delete(e.pointerId);
    if(!activePointers.size){viewerStage.classList.remove('is-dragging');swipeOriginX=null;}
  }
  viewerStage.addEventListener('pointerup',endPointer);
  viewerStage.addEventListener('pointercancel',endPointer);
  viewerStage.addEventListener('lostpointercapture',endPointer);
  window.addEventListener('resize',()=>{if(!viewer.hidden)renderZoom()});

  function card(p,index) {
    const article=document.createElement('article');
    article.className='product'+(p.vendido?' is-sold':'');
    const media=document.createElement('div');
    media.className='product-media';
    media.style.setProperty('--tile',colors[index%colors.length]);
    const placeholder=()=>{
      media.replaceChildren();
      const label=document.createElement('div');
      label.className='placeholder';
      const icon=document.createElement('span');
      icon.className='placeholder-symbol';
      icon.textContent=symbolByCategory[p.categoria] || '✦';
      const sub=document.createElement('span');
      sub.className='placeholder-label';
      sub.textContent='Fotografía próximamente';
      label.append(icon,sub);media.append(label,badge());
    };
    function badge(){
      const element=document.createElement('span');
      element.className='state-badge';
      element.textContent=p.vendido?'VENDIDO':'DISPONIBLE';
      return element;
    }
    if (p.imagen) {
      const zoomButton=document.createElement('button');
      zoomButton.type='button';
      zoomButton.className='product-zoom-trigger';
      zoomButton.setAttribute('aria-label','Ampliar fotografía de '+p.nombre);
      const img=document.createElement('img');
      img.src=p.imagen;img.alt=`Fotografía: ${p.nombre}`;img.loading='lazy';
      img.addEventListener('error',placeholder,{once:true});
      zoomButton.append(img);
      zoomButton.addEventListener('click',()=>openViewer(p));
      media.append(zoomButton,badge());
      if (galleryOf(p).length > 1) {
        const photosBadge = document.createElement('span');
        photosBadge.className = 'product-photo-count';
        photosBadge.textContent = galleryOf(p).length + ' fotos';
        media.append(photosBadge);
      }
    } else placeholder();
    const body=document.createElement('div');body.className='product-body';
    const cat=document.createElement('span');cat.className='product-category';cat.textContent=p.categoria;
    const name=document.createElement('h3');name.className='product-name';name.textContent=p.nombre;
    const description=document.createElement('p');description.className='product-description';description.textContent=p.descripcion || 'Artículo de segunda mano.';
    const price=document.createElement('div');price.className='product-price';price.textContent=currency.format(p.precio);
    const btn=p.vendido?document.createElement('button'):document.createElement('a');
    btn.className='buy-btn';
    if(p.vendido){btn.disabled=true;btn.textContent='Vendido';}
    else {btn.href=messageLink(p);btn.target='_blank';btn.rel='noopener noreferrer';btn.textContent='↗  Quiero este';btn.setAttribute('aria-label',`Consultar por WhatsApp: ${p.nombre}`);}
    body.append(cat,name,description,price,btn);article.append(media,body);
    return article;
  }
  function render(){
    const q=normalize(search.value);
    const status=filter.value;
    let displayed=products.filter(p => (status==='todos'||(status==='vendido'?p.vendido:!p.vendido)) && normalize([p.nombre,p.descripcion,p.categoria].join(' ')).includes(q));
    if(sort.value==='asc')displayed.sort((a,b)=>a.precio-b.precio);
    else if(sort.value==='desc')displayed.sort((a,b)=>b.precio-a.precio);
    else displayed.sort((a,b)=>Number(a.vendido)-Number(b.vendido));
    const available=products.filter(p=>!p.vendido).length;
    inventoryCount.textContent=`${available} disponible${available===1?'':'s'} · ${products.length} artículos`;
    const fragment=document.createDocumentFragment();
    displayed.forEach((p,i)=>fragment.append(card(p,i)));
    grid.replaceChildren(fragment);
    noResults.hidden=!!displayed.length;
  }
  search.addEventListener('input',render);
  filter.addEventListener('change',render);
  sort.addEventListener('change',render);
  document.getElementById('retry-button').addEventListener('click',loadProducts);
  loadProducts();
  // Si se deja abierta la página, refrescamos su estado cada 2 minutos.
  setInterval(() => {if(!document.hidden) loadProducts();},120000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) loadProducts();});
})();