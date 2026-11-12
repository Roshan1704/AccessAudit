/**
 * Controlled fixtures with known ground truth. Each inaccessible page contains one deliberate defect
 * (plus any rule that legitimately co-fires, listed in `allow`). The accessible pages implement the same
 * patterns correctly and must produce no confirmed or potential findings.
 */
export interface Fixture {
  name: string;
  html: string;
  /** Rules that must be reported on this page. */
  expect: string[];
  /** Rules that may also fire here without counting as a false positive. */
  allow: string[];
}

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture page</title><style>button,[role=tab]{min-width:44px;min-height:44px;margin:4px}</style></head><body><main><h1>Fixture</h1>${body}</main></body></html>`;
}

export const INACCESSIBLE: Fixture[] = [
  {
    name: 'image-no-alt',
    html: page(`<img src="${PIXEL}" width="40" height="40">`),
    expect: ['axe:image-alt'],
    allow: [],
  },
  {
    name: 'input-no-label',
    html: page(`<input type="text" name="q">`),
    expect: ['axe:label'],
    allow: [],
  },
  {
    name: 'button-no-name',
    html: page(`<button type="button"></button>`),
    expect: ['axe:button-name'],
    allow: [],
  },
  {
    name: 'low-contrast',
    html: page(`<p style="color:#bbbbbb;background:#ffffff">Pale grey text on white.</p>`),
    expect: ['axe:color-contrast'],
    allow: [],
  },
  {
    name: 'link-no-name',
    html: page(`<a href="/next"></a>`),
    expect: ['axe:link-name'],
    allow: ['custom:focus-hidden'],
  },
  {
    name: 'generic-link-text',
    html: page(`<p>Our new report is out. <a href="/report">Click here</a></p>`),
    expect: ['custom:generic-link-text'],
    allow: [],
  },
  {
    name: 'placeholder-only-label',
    html: page(`<input type="email" name="e" autocomplete="email" placeholder="Email address">`),
    expect: ['custom:placeholder-only-label'],
    allow: ['axe:label'],
  },
  {
    name: 'focus-indicator-removed',
    html: page(
      `<button type="button" style="outline:none">Save</button> <a href="/x" style="outline:none">Next step</a>`,
    ),
    expect: ['custom:focus-indicator'],
    allow: [],
  },
  {
    name: 'reflow-overflow',
    html: page(`<div style="width:900px;height:24px;background:#dde">Wide block</div>`),
    expect: ['custom:reflow'],
    allow: [],
  },
  {
    name: 'keyboard-trap',
    html: page(
      `<button id="a" type="button">First</button><button id="b" type="button">Second</button>
       <a href="/1">One</a> <a href="/2">Two</a> <a href="/3">Three</a> <a href="/4">Four</a>
       <script>
         var ids=['a','b'];
         document.addEventListener('keydown',function(e){
           if(e.key!=='Tab')return; e.preventDefault();
           var i=ids.indexOf(document.activeElement&&document.activeElement.id);
           document.getElementById(ids[(i+1)%2]).focus();
         });
       </script>`,
    ),
    expect: ['interaction:keyboard-trap'],
    allow: [],
  },
  {
    name: 'keyboard-unreachable',
    html: page(
      `<div role="button" id="d" style="padding:8px;border:1px solid #333;display:inline-block">Delete</div>`,
    ),
    expect: ['interaction:keyboard-unreachable'],
    allow: ['axe:nested-interactive'],
  },
  {
    name: 'dialog-bad',
    html: page(
      `<button type="button" id="open" aria-haspopup="dialog" aria-controls="dlg">Settings</button>
       <div id="dlg" role="dialog" aria-label="Settings" hidden><p>Options</p><button type="button" id="close">Close</button></div>
       <script>
         document.getElementById('open').addEventListener('click',function(){document.getElementById('dlg').hidden=false;});
         document.getElementById('close').addEventListener('click',function(){document.getElementById('dlg').hidden=true;});
       </script>`,
    ),
    expect: ['interaction:dialog-focus', 'interaction:dialog-escape'],
    allow: ['interaction:dialog-focus-return'],
  },
  {
    name: 'disclosure-state-not-updated',
    html: page(
      `<button type="button" id="t" aria-expanded="false" aria-controls="p">Details</button>
       <div id="p" hidden>More details here.</div>
       <script>document.getElementById('t').addEventListener('click',function(){var p=document.getElementById('p');p.hidden=!p.hidden;});</script>`,
    ),
    expect: ['interaction:disclosure-state'],
    allow: [],
  },
  {
    name: 'menu-button-no-expanded',
    html: page(`<button type="button" aria-haspopup="menu">Actions</button>`),
    expect: ['interaction:menu-keyboard'],
    allow: [],
  },
  {
    name: 'tabs-not-selected',
    html: page(
      `<div role="tablist" aria-label="Sections">
         <button role="tab" id="t1" aria-selected="true" aria-controls="p1">One</button>
         <button role="tab" id="t2" aria-selected="false" aria-controls="p2" tabindex="-1">Two</button>
       </div>
       <div role="tabpanel" id="p1" aria-labelledby="t1">Panel one</div>
       <div role="tabpanel" id="p2" aria-labelledby="t2" hidden>Panel two</div>`,
    ),
    expect: ['interaction:tab-pattern'],
    allow: ['axe:aria-allowed-attr'],
  },
  {
    name: 'dynamic-content-silent',
    html: page(
      `<button type="button" id="b">Check availability</button><div id="out"></div>
       <script>document.getElementById('b').addEventListener('click',function(){document.getElementById('out').textContent='Three seats are left.';});</script>`,
    ),
    expect: ['interaction:dynamic-status'],
    allow: [],
  },
  {
    name: 'error-not-associated',
    html: page(
      `<label for="n">Name</label><input id="n" name="n" aria-invalid="true"><p>This field is required</p>`,
    ),
    expect: ['interaction:form-error-association'],
    allow: [],
  },
  {
    name: 'form-no-autocomplete',
    html: page(`<label for="em">Email address</label><input id="em" name="email" type="email">`),
    expect: ['custom:missing-autocomplete'],
    allow: [],
  },
  {
    name: 'radio-group-no-legend',
    html: page(
      `<p>Contact method</p><input type="radio" name="c" id="c1"><label for="c1">Email</label><input type="radio" name="c" id="c2"><label for="c2">Phone</label>`,
    ),
    expect: ['custom:group-no-legend'],
    allow: [],
  },
  {
    name: 'required-visual-only',
    html: page(`<label for="rq">Full name *</label><input id="rq" name="rq" autocomplete="name">`),
    expect: ['custom:required-not-programmatic'],
    allow: [],
  },
  {
    name: 'media-needs-human',
    html: page(`<video controls style="max-width:100%" width="240" height="135"></video>`),
    expect: ['manual:media-alternatives'],
    allow: ['axe:video-caption'],
  },
];

export const ACCESSIBLE: Fixture[] = [
  {
    name: 'accessible-content',
    html: page(
      `<img src="${PIXEL}" alt="A single white pixel used as a spacer" width="40" height="40">
       <p style="color:#222;background:#fff">Dark text on white background.</p>
       <p>Read the <a href="/report">annual accessibility report</a> for details.</p>
       <form>
         <label for="e">Email address</label><input id="e" name="e" type="email" autocomplete="email" placeholder="you@example.com">
         <label for="n">Name</label><input id="n" name="n" aria-invalid="true" aria-describedby="n-err"><p id="n-err">Enter your name</p>
         <button type="button">Subscribe</button>
       </form>`,
    ),
    expect: [],
    allow: [],
  },
  {
    name: 'accessible-form',
    html: page(
      `<form>
         <fieldset><legend>Contact method</legend>
           <input type="radio" name="c" id="c1" checked><label for="c1">Email</label>
           <input type="radio" name="c" id="c2"><label for="c2">Phone</label>
         </fieldset>
         <label for="fn">Full name (required)</label><input id="fn" name="name" autocomplete="name" required>
         <label for="ph">Phone</label><input id="ph" name="phone" type="tel" autocomplete="tel">
         <label for="msg">Message</label><textarea id="msg" name="msg"></textarea>
         <button type="submit">Send</button>
       </form>`,
    ),
    expect: [],
    allow: [],
  },
  {
    name: 'accessible-structure',
    html: page(
      `<style>nav a{display:inline-block;min-height:44px;min-width:44px;line-height:44px}</style>
       <nav aria-label="Primary"><ul><li><a href="/pricing">Pricing plans</a></li><li><a href="/docs">Documentation</a></li></ul></nav>
       <h2>Sizes</h2>
       <table><caption>Plan sizes</caption><thead><tr><th scope="col">Plan</th><th scope="col">Seats</th></tr></thead><tbody><tr><th scope="row">Team</th><td>10</td></tr></tbody></table>
       <h2>Contact</h2><p>Write to <a href="mailto:hi@example.com">our support team</a>.</p>`,
    ),
    expect: [],
    allow: [],
  },
  {
    name: 'accessible-patterns',
    html: page(
      `<button type="button" id="open" aria-haspopup="dialog" aria-controls="dlg">Settings</button>
       <dialog id="dlg" aria-label="Settings"><p>Options</p><button type="button" id="close">Close</button></dialog>

       <button type="button" id="t" aria-expanded="false" aria-controls="p">Details</button>
       <div id="p" hidden>More details here.</div>

       <button type="button" id="m" aria-haspopup="menu" aria-expanded="false">Actions</button>

       <div role="tablist" aria-label="Sections">
         <button role="tab" id="t1" aria-selected="true" aria-controls="p1">One</button>
         <button role="tab" id="t2" aria-selected="false" aria-controls="p2" tabindex="-1">Two</button>
       </div>
       <div role="tabpanel" id="p1" aria-labelledby="t1" tabindex="0">Panel one</div>
       <div role="tabpanel" id="p2" aria-labelledby="t2" hidden tabindex="0">Panel two</div>

       <button type="button" id="b">Check availability</button><div id="out" role="status"></div>
       <script>
         var dlg=document.getElementById('dlg');
         document.getElementById('open').addEventListener('click',function(){dlg.showModal();});
         document.getElementById('close').addEventListener('click',function(){dlg.close();});
         var t=document.getElementById('t'),p=document.getElementById('p');
         t.addEventListener('click',function(){var x=t.getAttribute('aria-expanded')==='true';t.setAttribute('aria-expanded',String(!x));p.hidden=x;});
         var m=document.getElementById('m');
         m.addEventListener('click',function(){m.setAttribute('aria-expanded',String(m.getAttribute('aria-expanded')!=='true'));});
         function select(id){['t1','t2'].forEach(function(k,i){var on=k===id;document.getElementById(k).setAttribute('aria-selected',String(on));document.getElementById(k).tabIndex=on?0:-1;document.getElementById('p'+(i+1)).hidden=!on;});}
         document.getElementById('t1').addEventListener('click',function(){select('t1');});
         document.getElementById('t2').addEventListener('click',function(){select('t2');});
         document.getElementById('b').addEventListener('click',function(){document.getElementById('out').textContent='Three seats are left.';});
       </script>`,
    ),
    expect: [],
    allow: [],
  },
];
