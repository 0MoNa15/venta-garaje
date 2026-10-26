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
      return extra ? { ...item, ...extra, imagen: item.imagen || extra.imagen } : item;
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
      const img=document.createElement('img');
      img.src=p.imagen;img.alt=`Fotografía: ${p.nombre}`;img.loading='lazy';
      img.addEventListener('error',placeholder,{once:true});
      media.append(img,badge());
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