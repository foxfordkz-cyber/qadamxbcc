// Labels and facts are escaped before entering either the mobile view or the print surface.
export function packetView(lines, escape) {
  const summary=lines.slice(-3);
  return '<article class="packet-sheet"><header><span>QADAM SHIELD</span><h1>'+escape(lines[0])+
    '</h1><small>'+escape(lines[1])+'</small></header><div class="packet-meta">'+escape(lines[2])+
    '</div><section><h2>'+escape(lines[3])+'</h2><ol class="packet-list">'+lines.slice(4,-3).map(item=>
      '<li>'+escape(item)+'</li>').join('')+'</ol></section><section class="packet-draft"><h2>'+escape(summary[0])+
    '</h2><p>'+escape(summary[1])+'</p></section><footer>'+escape(summary[2])+'</footer></article>';
}

