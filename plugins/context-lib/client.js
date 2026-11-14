window.__ModuleLoader__.load({
  id: "dsh-context-lib",
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
var st=Object.create;var ge=Object.defineProperty;var dt=Object.getOwnPropertyDescriptor;var bt=Object.getOwnPropertyNames;var pt=Object.getPrototypeOf,ut=Object.prototype.hasOwnProperty;var mt=(e,i)=>{for(var a in i)ge(e,a,{get:i[a],enumerable:!0})},Pe=(e,i,a,n)=>{if(i&&typeof i=="object"||typeof i=="function")for(let c of bt(i))!ut.call(e,c)&&c!==a&&ge(e,c,{get:()=>i[c],enumerable:!(n=dt(i,c))||n.enumerable});return e};var Ie=(e,i,a)=>(a=e!=null?st(pt(e)):{},Pe(i||!e||!e.__esModule?ge(a,"default",{value:e,enumerable:!0}):a,e)),gt=e=>Pe(ge({},"__esModule",{value:!0}),e);var Bt={};mt(Bt,{apply:()=>Dt,inject:()=>Rt});module.exports=gt(Bt);var re=Ie(require("react"),1);var o=Ie(require("react"),1);var Se="/api/context-lib";function fe(e){let i=new URLSearchParams;for(let[n,c]of Object.entries(e??{}))c==null||c===""||i.set(n,String(c));let a=i.toString();return a?`?${a}`:""}function Le(e,i,a){let n=new Error(String(e));return n.code=i?.error?.code,n.hint=i?.error?.hint,n.status=a,n}async function T(e,i={}){let{method:a="GET",body:n,signal:c,headers:u}=i,p={method:a,signal:c,credentials:"same-origin",headers:{accept:"application/json",...u??{}}};n!==void 0&&(p.headers["content-type"]="application/json",p.body=JSON.stringify(n));let x;try{x=await fetch(Se+e,p)}catch(w){throw w?.name==="AbortError"?w:Le(`\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF1A${w?.message??"\u672A\u77E5\u9519\u8BEF"}`,null,0)}let N=await x.text(),d=null;try{d=N?JSON.parse(N):null}catch{d=null}if(!x.ok||d?.ok===!1){let w=d?.error?.message??d?.message??(N&&!d?N:`HTTP ${x.status}`);throw Le(w,d,x.status)}return d&&typeof d=="object"&&"ok"in d?d.data:d}function Ee(e){return T("/state",e)}function $e(e={},i={}){return T(`/items${fe(e)}`,i)}function Fe(e,i){return T(`/items/${encodeURIComponent(e)}`,i)}function De(e,{maxChars:i,startLine:a,endLine:n,signal:c}={}){return T(`/items/${encodeURIComponent(e)}/content${fe({maxChars:i,startLine:a,endLine:n})}`,{signal:c})}function Re(e){return`${Se}/items/${encodeURIComponent(e)}/raw`}function Be(e,{maxChars:i,signal:a}={}){return T(`/items/${encodeURIComponent(e)}/preview${fe({maxChars:i})}`,{signal:a})}function Ae(e){return`${Se}/items/${encodeURIComponent(e)}/thumb`}function je(e,i){return T("/items",{...i,method:"POST",body:e})}function He(e,i,a){return T(`/items/${encodeURIComponent(e)}`,{...a,method:"PATCH",body:i})}function Oe(e,i){return T(`/items/${encodeURIComponent(e)}`,{...i,method:"DELETE"})}function Ue(e,i){return T(`/items/${encodeURIComponent(e)}/restore`,{...i,method:"POST"})}function Ke(e,i){return T(`/items/${encodeURIComponent(e)}/purge`,{...i,method:"DELETE"})}function Ve(e,i){return T(`/items/${encodeURIComponent(e)}/reveal`,{...i,method:"POST"})}function _e({sourceId:e,force:i=!1}={},a){return T("/scan",{...a,method:"POST",body:{sourceId:e,force:i}})}function qe(e,i){return T("/sources",{...i,method:"POST",body:e})}function Ge(e,i){return T(`/sources/${encodeURIComponent(e)}`,{...i,method:"DELETE"})}function We({limit:e=50,offset:i=0}={},a){return T(`/trash${fe({limit:e,offset:i})}`,a)}var Ye={panelTitle:"\u8D44\u6E90\u5E93",appTitle:"\u8D44\u6E90\u5E93",appSub:"\u6587\u6863 / \u811A\u672C / \u56FE\u7247\uFF0C\u4E00\u5904\u68C0\u7D22",searchPlaceholder:"\u68C0\u7D22\u6807\u9898\u3001\u6807\u7B7E\u3001\u8DEF\u5F84\u3001\u6B63\u6587\u2026",kindAll:"\u5168\u90E8\u7C7B\u578B",kindDoc:"\u6587\u6863",kindScript:"\u811A\u672C",kindImage:"\u56FE\u7247",kindData:"\u6570\u636E",kindSession:"\u4F1A\u8BDD",kindNote:"\u7B14\u8BB0",kindOther:"\u5176\u4ED6",sortLabel:"\u6392\u5E8F",sortRelevance:"\u76F8\u5173\u5EA6",sortUpdated:"\u66F4\u65B0\u65F6\u95F4",sortTitle:"\u6807\u9898",sortSize:"\u5927\u5C0F",scan:"\u626B\u63CF",scanning:"\u626B\u63CF\u4E2D\u2026",newNote:"\u65B0\u5EFA\u7B14\u8BB0",trashToggle:"\u56DE\u6536\u7AD9",refresh:"\u5237\u65B0",backToChat:"\u8FD4\u56DE\u5BF9\u8BDD",sources:"\u6765\u6E90",collections:"\u5F52\u7C7B",tags:"\u6807\u7B7E",allSources:"\u5168\u90E8\u6765\u6E90",allCollections:"\u5168\u90E8\u5F52\u7C7B",addSource:"\u6DFB\u52A0\u6765\u6E90",sourceName:"\u540D\u79F0",sourcePath:"\u8DEF\u5F84\uFF08\u7EDD\u5BF9\u8DEF\u5F84\u6216 ~ \u5F00\u5934\uFF09",add:"\u6DFB\u52A0",removeSource:"\u79FB\u9664\u6765\u6E90",removeSourceConfirm:"\u79FB\u9664\u6765\u6E90\u300C{name}\u300D\uFF1F\u5B83\u7D22\u5F15\u7684\u6761\u76EE\u4E5F\u4F1A\u4E00\u5E76\u79FB\u9664\uFF08\u4E0D\u4F1A\u52A8\u539F\u6587\u4EF6\uFF09\u3002",sourceAdded:"\u5DF2\u6DFB\u52A0\u6765\u6E90\u300C{name}\u300D",sourceRemoved:"\u5DF2\u79FB\u9664\u6765\u6E90",sourceMissing:"\u8DEF\u5F84\u4E0D\u5B58\u5728",unknownSource:"\u672A\u6807\u6CE8\u6765\u6E90",sourceCount:"{n} \u6761",emptyTitle:"\u8D44\u6E90\u5E93\u8FD8\u662F\u7A7A\u7684",emptyBody:"\u70B9\u9876\u90E8\u300C\u626B\u63CF\u300D\u628A\u6765\u6E90\u91CC\u7684\u6587\u4EF6\u6536\u8FDB\u6765\uFF0C\u6216\u8005\u5148\u5199\u4E00\u6761\u7B14\u8BB0\u3002",emptyFiltered:"\u6CA1\u6709\u5339\u914D\u7684\u6761\u76EE",emptyFilteredBody:"\u6362\u4E2A\u5173\u952E\u8BCD\uFF0C\u6216\u8005\u6E05\u6389\u7B5B\u9009\u6761\u4EF6\u518D\u8BD5\u3002",emptyTrash:"\u56DE\u6536\u7AD9\u662F\u7A7A\u7684",emptyTrashBody:"\u5220\u9664\u7684\u6761\u76EE\u4F1A\u5148\u6765\u8FD9\u91CC\uFF0C\u518D\u51B3\u5B9A\u6062\u590D\u8FD8\u662F\u5F7B\u5E95\u5220\u9664\u3002",clearFilters:"\u6E05\u6389\u7B5B\u9009",loading:"\u52A0\u8F7D\u4E2D\u2026",loadMore:"\u52A0\u8F7D\u66F4\u591A",loadingMore:"\u6B63\u5728\u52A0\u8F7D\u2026",totalCount:"\u5171 {n} \u6761",detailEmpty:"\u9009\u4E00\u6761\u67E5\u770B\u8BE6\u60C5",detailEmptyBody:"\u6807\u9898\u3001\u6807\u7B7E\u3001\u5907\u6CE8\u548C\u6B63\u6587\u9884\u89C8\u90FD\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002",loadingDetail:"\u6B63\u5728\u8BFB\u8FD9\u4E00\u6761\u2026",fieldTitle:"\u6807\u9898",fieldCollection:"\u5F52\u7C7B",fieldTags:"\u6807\u7B7E",fieldTagsHint:"\u7528\u9017\u53F7\u5206\u9694",fieldNotes:"\u5907\u6CE8",fieldNotesPlaceholder:"\u7ED9\u8FD9\u6761\u8D44\u6599\u5199\u70B9\u7528\u6CD5\u63D0\u793A\uFF0C\u68C0\u7D22\u65F6\u4E5F\u4F1A\u547D\u4E2D\u2026",fieldContent:"\u6B63\u6587",save:"\u4FDD\u5B58",saving:"\u4FDD\u5B58\u4E2D\u2026",saved:"\u5DF2\u4FDD\u5B58",copyPath:"\u590D\u5236\u8DEF\u5F84",copyContent:"\u590D\u5236\u5185\u5BB9",copied:"\u5DF2\u590D\u5236",copyFailed:"\u590D\u5236\u5931\u8D25\uFF0C\u6D4F\u89C8\u5668\u62D2\u7EDD\u4E86\u526A\u8D34\u677F\u8BBF\u95EE",revealInFinder:"\u5728\u8BBF\u8FBE\u4E2D\u663E\u793A",revealing:"\u6B63\u5728\u6253\u5F00\u8BBF\u8FBE\u2026",revealed:"\u5DF2\u5728\u8BBF\u8FBE\u4E2D\u5B9A\u4F4D",noPath:"\u8FD9\u6761\u6CA1\u6709\u539F\u6587\u4EF6\u8DEF\u5F84\uFF08\u526F\u672C\u6216\u7B14\u8BB0\uFF09",noTags:"\u6682\u65E0\u6807\u7B7E",delete:"\u5220\u9664",deleting:"\u5220\u9664\u4E2D\u2026",deleteConfirm:"\u5220\u9664\u300C{title}\u300D\uFF1F",deleteConfirmBody:"\u6761\u76EE\u4F1A\u8FDB\u56DE\u6536\u7AD9\uFF0C\u4E4B\u540E\u8FD8\u80FD\u6062\u590D\u3002",deleteConfirmLinked:"\u8FD9\u662F\u7D22\u5F15\u6761\u76EE\uFF1A\u5220\u9664\u53EA\u79FB\u9664\u7D22\u5F15\uFF0C\u4E0D\u4F1A\u52A8\u539F\u6587\u4EF6\u3002",cancel:"\u53D6\u6D88",confirm:"\u786E\u5B9A",restore:"\u6062\u590D",purge:"\u5F7B\u5E95\u5220\u9664",purgeConfirm:"\u5F7B\u5E95\u5220\u9664\u300C{title}\u300D\uFF1F",purgeConfirmBody:"\u6587\u4EF6\u526F\u672C\u6216\u7B14\u8BB0\u6B63\u6587\u4F1A\u88AB\u5220\u6389\uFF0C\u65E0\u6CD5\u6062\u590D\u3002\u7D22\u5F15\u6761\u76EE\u53EA\u5220\u7D22\u5F15\uFF0C\u4E0D\u4F1A\u52A8\u539F\u6587\u4EF6\u3002",deleteDone:"\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9",restored:"\u5DF2\u6062\u590D",purgeDone:"\u5DF2\u5F7B\u5E95\u5220\u9664",trashHint:"\u56DE\u6536\u7AD9\u91CC\u7684\u6761\u76EE\u4E0D\u53EF\u7F16\u8F91\uFF0C\u53EF\u4EE5\u6062\u590D\u6216\u5F7B\u5E95\u5220\u9664\u3002",storageNote:"\u672C\u5E93\u7B14\u8BB0",storageLinked:"\u7D22\u5F15",storageBlob:"\u526F\u672C",linesTotal:"\u5171 {n} \u884C",linesShown:"\u663E\u793A\u524D {shown} \u884C",truncated:"\u5DF2\u622A\u65AD",binaryPreview:"\u8FD9\u4E2A\u6587\u4EF6\u662F\u4E8C\u8FDB\u5236\uFF0C\u6CA1\u6CD5\u5728\u8FD9\u91CC\u9884\u89C8\u3002",imagePreview:"\u56FE\u7247\u9884\u89C8",previewFailed:"\u9884\u89C8\u52A0\u8F7D\u5931\u8D25",pathLabel:"\u8DEF\u5F84",scanDone:"\u626B\u63CF\u5B8C\u6210",scanFailed:"\u626B\u63CF\u5931\u8D25",scanResult:"{name}\uFF1A\u65B0\u589E {added} \xB7 \u66F4\u65B0 {updated} \xB7 \u79FB\u9664 {removed} \xB7 \u8DF3\u8FC7 {skipped} \xB7 \u9519\u8BEF {errors}",scanNoSources:"\u6CA1\u6709\u53EF\u626B\u63CF\u7684\u6765\u6E90\uFF0C\u5148\u6DFB\u52A0\u4E00\u4E2A\u3002",scanErrorsMore:"\u8FD8\u6709 {n} \u6761\u9519\u8BEF",scanErrorLine:"{path}\uFF1A{message}",noteCreated:"\u7B14\u8BB0\u5DF2\u521B\u5EFA",noteTitlePlaceholder:"\u7B14\u8BB0\u6807\u9898",noteContentPlaceholder:"\u4ECE\u8FD9\u91CC\u5F00\u59CB\u5199\u2026",create:"\u521B\u5EFA",creating:"\u521B\u5EFA\u4E2D\u2026",errorPrefix:"\u51FA\u9519\u4E86",close:"\u5173\u95ED",untitled:"\u65E0\u6807\u9898"},Qe={panelTitle:"Library",appTitle:"Context Library",appSub:"Docs / scripts / images, one search",searchPlaceholder:"Search titles, tags, paths, text\u2026",kindAll:"All types",kindDoc:"Docs",kindScript:"Scripts",kindImage:"Images",kindData:"Data",kindSession:"Sessions",kindNote:"Notes",kindOther:"Other",sortLabel:"Sort",sortRelevance:"Relevance",sortUpdated:"Updated",sortTitle:"Title",sortSize:"Size",scan:"Scan",scanning:"Scanning\u2026",newNote:"New note",trashToggle:"Trash",refresh:"Refresh",backToChat:"Back to chat",sources:"Sources",collections:"Collections",tags:"Tags",allSources:"All sources",allCollections:"All collections",addSource:"Add source",sourceName:"Name",sourcePath:"Path (absolute or starting with ~)",add:"Add",removeSource:"Remove source",removeSourceConfirm:'Remove source "{name}"? Entries indexed from it are removed too (original files are untouched).',sourceAdded:'Source "{name}" added',sourceRemoved:"Source removed",sourceMissing:"Path not found",unknownSource:"No source",sourceCount:"{n} items",emptyTitle:"The library is empty",emptyBody:'Hit "Scan" above to pull files in, or write a note first.',emptyFiltered:"No matching entries",emptyFilteredBody:"Try another keyword, or clear the filters.",emptyTrash:"Trash is empty",emptyTrashBody:"Deleted entries land here before you restore or purge them.",clearFilters:"Clear filters",loading:"Loading\u2026",loadMore:"Load more",loadingMore:"Loading\u2026",totalCount:"{n} items",detailEmpty:"Select an entry",detailEmptyBody:"Title, tags, notes and a text preview show up here.",loadingDetail:"Reading this entry\u2026",fieldTitle:"Title",fieldCollection:"Collection",fieldTags:"Tags",fieldTagsHint:"comma separated",fieldNotes:"Notes",fieldNotesPlaceholder:"Notes for future you \u2014 search matches here too\u2026",fieldContent:"Content",save:"Save",saving:"Saving\u2026",saved:"Saved",copyPath:"Copy path",copyContent:"Copy content",copied:"Copied",copyFailed:"Copy failed \u2014 the browser denied clipboard access",revealInFinder:"Reveal in Finder",revealing:"Opening Finder\u2026",revealed:"Revealed in Finder",noPath:"No original path (note or copy)",noTags:"No tags",delete:"Delete",deleting:"Deleting\u2026",deleteConfirm:'Delete "{title}"?',deleteConfirmBody:"It goes to trash and can be restored later.",deleteConfirmLinked:"This is an index entry: deleting removes the index only, never the original file.",cancel:"Cancel",confirm:"Confirm",restore:"Restore",purge:"Purge",purgeConfirm:'Permanently delete "{title}"?',purgeConfirmBody:"Copied blobs or note content are deleted for good. Index entries only lose the index row.",deleteDone:"Moved to trash",restored:"Restored",purgeDone:"Permanently deleted",trashHint:"Trashed entries are read-only; restore or purge them.",storageNote:"Library note",storageLinked:"Index",storageBlob:"Copy",linesTotal:"{n} lines",linesShown:"showing first {shown}",truncated:"truncated",binaryPreview:"Binary file \u2014 no preview here.",imagePreview:"Image preview",previewFailed:"Preview failed to load",pathLabel:"Path",scanDone:"Scan finished",scanFailed:"Scan failed",scanResult:"{name}: added {added} \xB7 updated {updated} \xB7 removed {removed} \xB7 skipped {skipped} \xB7 errors {errors}",scanNoSources:"No sources to scan yet \u2014 add one first.",scanErrorsMore:"{n} more errors",scanErrorLine:"{path}: {message}",noteCreated:"Note created",noteTitlePlaceholder:"Note title",noteContentPlaceholder:"Start writing\u2026",create:"Create",creating:"Creating\u2026",errorPrefix:"Something went wrong",close:"Close",untitled:"Untitled"};function j(e,i={}){return String(e??"").replace(/\{(\w+)\}/g,(a,n)=>Object.prototype.hasOwnProperty.call(i,n)?String(i[n]??""):a)}var t=o.default.createElement,Xe=50,Ce=2e4,Je=400,Ze=/^(doc|docx|rtf|rtfd|odt|pdf|xls|xlsx|ppt|pptx|key|pages|numbers|epub|html|htm|xhtml)$/i,ht={fill:"none",stroke:"currentColor",strokeWidth:1.4,strokeLinecap:"round",strokeLinejoin:"round"},b=(e,i)=>t(e,i),et={search:[b("circle",{cx:7,cy:7,r:4.3}),b("path",{d:"M10.2 10.2 13.4 13.4"})],plus:[b("path",{d:"M8 3v10M3 8h10"})],refresh:[b("path",{d:"M13 8a5 5 0 1 1-1.5-3.6"}),b("path",{d:"M13 2.8V5.4h-2.6"})],scan:[b("path",{d:"M2.4 8a5.6 5.6 0 0 1 5.6-5.6M13.6 8A5.6 5.6 0 0 1 8 13.6"}),b("circle",{cx:8,cy:8,r:1.5}),b("path",{d:"M8 2.4v2M8 11.6v2M2.4 8h2M11.6 8h2"})],trash:[b("path",{d:"M2.8 4.2h10.4M5.8 4.2V2.8h4.4v1.4M4.2 4.2l.7 9h6.2l.7-9M6.7 6.8v4M9.3 6.8v4"})],close:[b("path",{d:"M4 4l8 8M12 4l-8 8"})],chevron:[b("path",{d:"M6 3.6 10.4 8 6 12.4"})],back:[b("path",{d:"M13 8H3M7 4 3 8l4 4"})],book:[b("path",{d:"M2 3.2h3.7c1.2 0 2.3.7 2.3 1.8v8c-.4-1.1-1.5-1.8-2.7-1.8H2zM8 5c0-1.1 1.1-1.8 2.3-1.8H14v8h-3.7c-1.2 0-2.3.7-2.3 1.8"})],doc:[b("path",{d:"M4 1.8h4.7l3.5 3.5v8.9H4zM8.6 1.8v3.7h3.6"})],script:[b("rect",{x:2.2,y:2.4,width:11.6,height:11.2,rx:1.6}),b("path",{d:"M6.2 6 4.3 8l1.9 2M9.8 6 11.7 8l-1.9 2"})],image:[b("rect",{x:2,y:3,width:12,height:10,rx:1.5}),b("circle",{cx:6,cy:6.5,r:1}),b("path",{d:"M2.8 12 6 9l2.2 2 2.6-2.6 2.6 4.1"})],data:[b("ellipse",{cx:8,cy:4,rx:5,ry:2}),b("path",{d:"M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"})],session:[b("path",{d:"M2.4 3.4h11.2v7.2H7.2L4 13.4v-2.8H2.4zM5 6.2h6M5 8.2h4"})],note:[b("path",{d:"M3 1.8h10v9.4L10.2 14H3zM10.2 14v-2.8H13M5.4 5.2h5M5.4 7.4h3.4"})],other:[b("path",{d:"M4 1.8h4.7l3.5 3.5v8.9H4zM8.6 1.8v3.7h3.6M6 9h4"})],folder:[b("path",{d:"M2 4.2h4l1.4 1.6H14v7.6H2z"})],tag:[b("path",{d:"M2.4 2.4h5.1l6.1 6.1-5.1 5.1-6.1-6.1z"}),b("circle",{cx:5.6,cy:5.6,r:1})],copy:[b("rect",{x:5.2,y:5.2,width:8,height:8,rx:1.4}),b("path",{d:"M10.8 5.2V4a1.4 1.4 0 0 0-1.4-1.4H4A1.4 1.4 0 0 0 2.6 4v5.4A1.4 1.4 0 0 0 4 10.8h1.2"})],save:[b("path",{d:"M2.8 2.8h8.8l1.6 1.6v8.8H2.8zM5 2.8v3.4h5V2.8M5 13.2V9.4h6v3.8"})],restore:[b("path",{d:"M3 5.6A5.4 5.4 0 1 1 2.8 9M2.6 2.6v3.2h3.2"})],check:[b("path",{d:"M3 8.4 6.4 12 13 4.6"})]};function h({name:e,size:i=14}){let a=et[e]??et.other;return t("svg",{width:i,height:i,viewBox:"0 0 16 16",...ht,"aria-hidden":!0},a.map((n,c)=>o.default.cloneElement(n,{key:c})))}var xt=["doc","script","image","data","session","note"],vt=["relevance","updated","title","size"],he={doc:"kindDoc",script:"kindScript",image:"kindImage",data:"kindData",session:"kindSession",note:"kindNote",other:"kindOther"};function tt(e){return he[e]?e:"other"}function Te(e){let i=Number(e);if(!Number.isFinite(i)||i<=0)return"0 B";let a=["B","KB","MB","GB"],n=i,c=0;for(;n>=1024&&c<a.length-1;)n/=1024,c+=1;return`${c===0||n>=10?Math.round(n):n.toFixed(1)} ${a[c]}`}function it(e){if(!e)return"";let i=new Date(e);if(Number.isNaN(i.getTime()))return"";let a=n=>String(n).padStart(2,"0");return`${i.getFullYear()}-${a(i.getMonth()+1)}-${a(i.getDate())} ${a(i.getHours())}:${a(i.getMinutes())}`}function yt(e){let i=new Set,a=[];for(let n of String(e??"").split(/[,，\n]/)){let c=n.trim();if(!(!c||i.has(c))&&(i.add(c),a.push(c),a.length>=24))break}return a}async function wt(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}try{let i=document.createElement("textarea");i.value=e,i.setAttribute("readonly",""),i.style.position="fixed",i.style.top="-1000px",i.style.opacity="0",document.body.appendChild(i),i.select();let a=document.execCommand("copy");return i.remove(),a}catch{return!1}}function kt({t:e,onExit:i,qInput:a,onQuery:n,kind:c,onKind:u,sort:p,onSort:x,status:N,trashCount:d,onToggleTrash:w,onScan:L,scanning:l,onNewNote:P,onRefresh:S,refreshing:C}){return t("div",{className:"clib-toolbar"},t("button",{type:"button",className:"clib-btn clib-icon",onClick:i,title:e("backToChat"),"aria-label":e("backToChat")},t(h,{name:"back",size:14})),t("div",{className:"clib-brand"},t("b",null,e("appTitle")),t("small",null,e("appSub"))),t("label",{className:"clib-search"},t(h,{name:"search",size:13}),t("input",{type:"search",value:a,placeholder:e("searchPlaceholder"),"aria-label":e("searchPlaceholder"),onChange:m=>n(m.target.value)})),t("select",{className:"clib-select",value:c,"aria-label":e("kindAll"),disabled:N==="trashed",onChange:m=>u(m.target.value)},t("option",{value:""},e("kindAll")),...xt.map(m=>t("option",{key:m,value:m},e(he[m])))),t("select",{className:"clib-select",value:p,"aria-label":e("sortLabel"),disabled:N==="trashed",onChange:m=>x(m.target.value)},...vt.map(m=>t("option",{key:m,value:m},e(`sort${m[0].toUpperCase()}${m.slice(1)}`)))),t("button",{type:"button",className:"clib-btn",onClick:L,disabled:l,title:e("scan")},t(h,{name:"scan",size:13}),e(l?"scanning":"scan")),t("button",{type:"button",className:"clib-btn is-primary",onClick:P},t(h,{name:"plus",size:13}),e("newNote")),t("button",{type:"button",className:`clib-btn${N==="trashed"?" is-on":""}`,onClick:w,title:e("trashToggle")},t(h,{name:"trash",size:13}),e("trashToggle"),d>0?` ${d}`:""),t("button",{type:"button",className:"clib-btn clib-icon",onClick:S,disabled:C,title:e("refresh"),"aria-label":e("refresh")},t("span",{className:C?"clib-spin":void 0},t(h,{name:"refresh",size:14}))))}function Nt({t:e,sources:i,collections:a,tags:n,filters:c,disabled:u,onFilter:p,onAddSource:x,onRemoveSource:N}){let[d,w]=o.default.useState(!1),[L,l]=o.default.useState(""),[P,S]=o.default.useState(""),[C,m]=o.default.useState(!1);async function Z(r){if(r.preventDefault(),!L.trim()||!P.trim()||C)return;m(!0);let Q=await x({name:L.trim(),path:P.trim()});m(!1),Q&&(l(""),S(""),w(!1))}return t("aside",{className:"clib-side"},t("div",{className:"clib-side-title"},t("span",null,e("sources")),t("button",{type:"button",className:"clib-side-add",onClick:()=>w(r=>!r)},d?e("cancel"):`+ ${e("addSource")}`)),t("button",{type:"button",className:`clib-nav${c.source?"":" is-on"}`,disabled:u,onClick:()=>p({source:""})},t("span",{className:"clib-dot"}),t("span",{className:"clib-nav-label"},e("allSources"))),i.map(r=>t("div",{key:r.id,className:"clib-source-row"},t("button",{type:"button",className:`clib-nav${c.source===r.id?" is-on":""}`,disabled:u,title:r.path,onClick:()=>p({source:c.source===r.id?"":r.id})},t("span",{className:"clib-dot"}),t("span",{className:"clib-nav-label"},r.name,r.missing?t("span",{className:"clib-missing"},` \xB7 ${e("sourceMissing")}`):null),t("span",{className:"clib-count"},Number.isFinite(r.count)?r.count:"")),t("button",{type:"button",className:"clib-source-remove",title:e("removeSource"),"aria-label":e("removeSource"),onClick:()=>N(r)},t(h,{name:"close",size:11})))),d?t("form",{className:"clib-source-form",onSubmit:Z},t("input",{className:"clib-input",value:L,placeholder:e("sourceName"),"aria-label":e("sourceName"),onChange:r=>l(r.target.value)}),t("input",{className:"clib-input",value:P,placeholder:e("sourcePath"),"aria-label":e("sourcePath"),onChange:r=>S(r.target.value)}),t("div",{className:"clib-source-form-row"},t("button",{type:"button",className:"clib-btn",onClick:()=>w(!1)},e("cancel")),t("button",{type:"submit",className:"clib-btn is-primary",disabled:C||!L.trim()||!P.trim()},e(C?"loading":"add")))):null,t("div",{className:"clib-side-title"},t("span",null,e("collections"))),t("button",{type:"button",className:`clib-nav${c.collection?"":" is-on"}`,disabled:u,onClick:()=>p({collection:""})},t(h,{name:"folder",size:12}),t("span",{className:"clib-nav-label"},e("allCollections"))),a.length?a.map(r=>t("button",{key:r.name,type:"button",className:`clib-nav${c.collection===r.name?" is-on":""}`,disabled:u,onClick:()=>p({collection:c.collection===r.name?"":r.name})},t(h,{name:"folder",size:12}),t("span",{className:"clib-nav-label"},r.name),t("span",{className:"clib-count"},r.count))):t("div",{className:"clib-side-empty"},"\u2014"),t("div",{className:"clib-side-title"},t("span",null,e("tags"))),n.length?t("div",{className:"clib-tagcloud"},n.map(r=>t("button",{key:r.name,type:"button",className:`clib-tag${c.tag===r.name?" is-on":""}`,disabled:u,title:c.tag===r.name?`${e("tags")} \xB7 ${r.name}`:r.name,onClick:()=>p({tag:c.tag===r.name?"":r.name})},t("span",null,`#${r.name}`),t("em",null,r.count)))):t("div",{className:"clib-side-empty"},e("noTags")))}function St({t:e,item:i,active:a,sourceName:n,onClick:c}){let u=i.path||n||i.collection||"";return t("button",{type:"button",className:`clib-row${a?" is-on":""}`,onClick:c},t("span",{className:"clib-row-icon"},t(h,{name:tt(i.kind),size:15})),t("span",{className:"clib-row-body"},t("span",{className:"clib-row-title"},t("strong",null,i.title||e("untitled")),t("span",{className:"clib-badge"},e(he[i.kind]??"kindOther")),i.storage==="linked"?t("span",{className:"clib-badge"},e("storageLinked")):null),t("span",{className:"clib-row-meta"},u?t("span",{className:"clib-path"},u):null,t("span",{className:"clib-sep"},"\xB7"),t("span",{className:"clib-num"},Te(i.size)),t("span",{className:"clib-sep"},"\xB7"),t("span",{className:"clib-num"},it(i.updatedAt))),i.snippet?t("span",{className:"clib-row-snippet"},i.snippet):null,i.tags?.length?t("span",{className:"clib-row-tags"},i.tags.slice(0,4).map(p=>t("span",{key:p,className:"clib-mini-tag"},`#${p}`))):null))}function Ct(){return t(o.default.Fragment,null,Array.from({length:6},(e,i)=>t("div",{key:i,className:"clib-skel"},t("div",{className:"clib-skel-avatar clib-shimmer"}),t("div",{className:"clib-skel-lines"},t("div",{className:"clib-skel-line clib-shimmer",style:{width:`${58+i%3*11}%`}}),t("div",{className:"clib-skel-line clib-shimmer",style:{width:`${34+i%4*9}%`}}),t("div",{className:"clib-skel-line clib-shimmer",style:{width:"88%"}})))))}function ze({icon:e,title:i,body:a,action:n}){return t("div",{className:"clib-empty"},t("div",{className:"clib-empty-icon"},t(h,{name:e,size:22})),t("b",null,i),t("p",null,a),n||null)}function zt(e){let{t:i,items:a,total:n,loading:c,moreLoading:u,selectedId:p,onSelect:x,onLoadMore:N,status:d,hasFilters:w,onClearFilters:L,sourceNames:l,onNewNote:P}=e,S;return c&&!a.length?S=t(Ct):a.length?S=a.map(C=>t(St,{key:C.id,t:i,item:C,active:C.id===p,sourceName:l[C.sourceId]??"",onClick:()=>x(C.id)})):d==="trashed"?S=t(ze,{icon:"trash",title:i("emptyTrash"),body:i("emptyTrashBody")}):w?S=t(ze,{icon:"search",title:i("emptyFiltered"),body:i("emptyFilteredBody"),action:t("button",{type:"button",className:"clib-btn",onClick:L},i("clearFilters"))}):S=t(ze,{icon:"book",title:i("emptyTitle"),body:i("emptyBody"),action:t("button",{type:"button",className:"clib-btn is-primary",onClick:P},t(h,{name:"plus",size:13}),i("newNote"))}),t("main",{className:"clib-main"},t("div",{className:"clib-list-head"},t("span",null,c?i("loading"):j(i("totalCount"),{n})),t("b",null,d==="trashed"?i("trashToggle"):"")),t("div",{className:"clib-list"},S),a.length<n?t("div",{className:"clib-list-foot"},t("button",{type:"button",className:"clib-btn",disabled:u,onClick:N},i(u?"loadingMore":"loadMore"))):null)}function Tt(e,i){return{title:e.title??"",collection:e.collection??"inbox",tags:(e.tags??[]).join(", "),notes:e.notes??"",content:e.storage==="note"?i?.text??"":""}}function Mt({t:e,id:i,collections:a,sourceNames:n,onClose:c,onChanged:u,pushToast:p,toastError:x}){let[N,d]=o.default.useState(!1),[w,L]=o.default.useState(0),[l,P]=o.default.useState(null),[S,C]=o.default.useState(null),[m,Z]=o.default.useState(null),[r,Q]=o.default.useState(null),[ce,H]=o.default.useState(""),[k,I]=o.default.useState(""),[O,V]=o.default.useState(""),[se,ee]=o.default.useState(!1),[R,te]=o.default.useState(null),[ie,ae]=o.default.useState(!1);if(o.default.useEffect(()=>{if(!i)return;let f=!0;return d(!0),H(""),V(""),ee(!1),Promise.all([Fe(i),De(i,{maxChars:Ce}).catch(()=>null)]).then(([y,F])=>{if(!f)return;let D=y?.item??y??null;if(!D){H(e("errorPrefix")),d(!1);return}let ue=F??(y?.content?{text:y.content,totalLines:D.lines,truncated:!1}:null),me=Tt(D,ue);P(D),C(ue),Z(me),Q(me),d(!1),te(null);let we=String(D.ext||"");Ze.test(we)?(ae(!0),Be(i,{maxChars:Ce}).then(ke=>{f&&te(ke)}).catch(()=>{f&&te({kind:"none"})}).finally(()=>{f&&ae(!1)})):ae(!1)}).catch(y=>{f&&(d(!1),H(y?.message??String(y)),x(y))}),()=>{f=!1}},[i,w,e,x]),!i)return t("aside",{className:"clib-detail"},t("div",{className:"clib-placeholder"},t("div",{className:"clib-empty-icon"},t(h,{name:"book",size:22})),t("b",null,e("detailEmpty")),t("p",null,e("detailEmptyBody"))));let E=l?.status==="trashed",ve=!!r&&!!m&&(r.title!==m.title||r.collection!==m.collection||r.tags!==m.tags||r.notes!==m.notes||l?.storage==="note"&&r.content!==m.content),B=!!l&&(l.kind==="image"||String(l.mime??"").startsWith("image/")),_=S?.text??l?.preview??"",U=_?_.split(`
`):[],ne=U.slice(0,Je),q=U.length>Je,de=S?.totalLines??l?.lines??U.length,G=S?.truncated||q,pe=S?.binary===!0,X=l?.sourceId?n[l.sourceId]??l.sourceId:"",W=f=>y=>{let F=y.target.value;Q(D=>D&&{...D,[f]:F})};async function A(){if(!l||!r||k)return;let f={title:r.title.trim()||e("untitled"),collection:r.collection.trim()||"inbox",tags:yt(r.tags),notes:r.notes};l.storage==="note"&&r.content!==m.content&&(f.content=r.content),I("save");try{await He(i,f),p({type:"ok",title:e("saved")}),L(y=>y+1),u()}catch(y){x(y)}finally{I("")}}async function $(){if(!l||!O||k)return;let f=O==="purge";I(f?"purge":"delete");try{f?(await Ke(i),p({type:"ok",title:e("purgeDone")})):(await Oe(i),p({type:"ok",title:e("deleteDone")})),V(""),u(),c()}catch(y){x(y)}finally{I("")}}async function J(){if(!k){I("restore");try{await Ue(i),p({type:"ok",title:e("restored")}),u(),c()}catch(f){x(f)}finally{I("")}}}async function K(f,y){let F=await wt(f);return p(F?{type:"ok",title:e("copied")}:{type:"error",title:e("errorPrefix"),message:e("copyFailed")}),F&&y}async function le(){if(!(!l||k)){I("reveal");try{await Ve(l.id),p({type:"ok",title:e("revealed")})}catch(f){x(f)}finally{I("")}}}let be=t("div",{className:"clib-detail-head"},t(h,{name:l?tt(l.kind):"doc",size:18}),t("div",{className:"clib-detail-titles"},t("h2",null,l?.title||e("loadingDetail")),t("div",{className:"clib-detail-sub"},l?t("span",{className:"clib-badge"},e(he[l.kind]??"kindOther")):null,l?.storage?t("span",{className:"clib-badge"},e(`storage${l.storage[0].toUpperCase()}${l.storage.slice(1)}`)):null,X?t("span",null,X):null,l?t("span",null,Te(l.size)):null,l?t("span",null,it(l.updatedAt)):null)),t("button",{type:"button",className:"clib-btn clib-icon",onClick:c,title:e("close"),"aria-label":e("close")},t(h,{name:"close",size:13}))),Y;N?Y=t("div",{className:"clib-placeholder"},t("b",null,e("loadingDetail"))):ce?Y=t("div",{className:"clib-placeholder"},t("b",null,e("errorPrefix")),t("p",null,ce)):!l||!r?Y=t("div",{className:"clib-placeholder"},t("b",null,e("detailEmpty"))):Y=t(o.default.Fragment,null,t("div",{className:"clib-field"},t("label",{htmlFor:"clib-title"},e("fieldTitle")),t("input",{id:"clib-title",className:"clib-input",value:r.title,disabled:E,onChange:W("title")})),t("div",{className:"clib-field"},t("label",{htmlFor:"clib-collection"},e("fieldCollection")),t("input",{id:"clib-collection",className:"clib-input",value:r.collection,disabled:E,list:"clib-collection-options",onChange:W("collection")}),t("datalist",{id:"clib-collection-options"},(a??[]).map(f=>t("option",{key:f.name,value:f.name})))),t("div",{className:"clib-field"},t("label",{htmlFor:"clib-tags"},e("fieldTags"),t("small",null,e("fieldTagsHint"))),t("input",{id:"clib-tags",className:"clib-input",value:r.tags,disabled:E,onChange:W("tags")})),t("div",{className:"clib-field"},t("label",{htmlFor:"clib-notes"},e("fieldNotes")),t("textarea",{id:"clib-notes",className:"clib-textarea",rows:2,value:r.notes,disabled:E,placeholder:e("fieldNotesPlaceholder"),onChange:W("notes")})),l.storage==="note"?t("div",{className:"clib-field"},t("label",{htmlFor:"clib-content"},e("fieldContent")),t("textarea",{id:"clib-content",className:"clib-textarea",rows:6,value:r.content,disabled:E,spellCheck:!1,onChange:W("content")})):null,l.path?t("div",{className:"clib-field"},t("label",null,e("pathLabel")),t("div",{className:"clib-path-row"},t("code",{className:"clib-path-line",title:l.path},l.path),t("button",{type:"button",className:"clib-icon-btn",title:e("copyPath"),"aria-label":e("copyPath"),onClick:()=>K(l.path,"path")},t(h,{name:"copy",size:12})),t("button",{type:"button",className:"clib-icon-btn",title:e("revealInFinder"),"aria-label":e("revealInFinder"),disabled:!!k,onClick:le},t(h,{name:"folder",size:12})))):null,E?t("div",{className:"clib-hint"},e("trashHint")):null,t("div",{className:"clib-preview"},t("div",{className:"clib-preview-head"},t("span",null,e(B?"imagePreview":"fieldContent")),t("span",null,B?`${Te(l.size)}`:G?`${j(e("linesTotal"),{n:de})} \xB7 ${e("truncated")}`:_?j(e("linesTotal"),{n:de}):"")),B?t("div",{className:"clib-image-wrap"},se?t("span",{className:"clib-hint"},e("previewFailed")):t("img",{src:Re(l.id),alt:l.title||e("imagePreview"),loading:"lazy",onError:()=>ee(!0)})):Ze.test(String(l?.ext||""))?ie?t("div",{className:"clib-hint"},e("loading")):R?.kind==="text"?t("div",{className:"clib-doc-text"},t("pre",{className:"clib-code"},String(R.text||"").slice(0,Ce)),R.note?t("div",{className:"clib-hint"},R.note):null):R?.kind==="thumb"?t("div",{className:"clib-image-wrap"},t("img",{src:Ae(l.id),alt:l.title||e("fieldContent"),loading:"lazy",onError:()=>ee(!0)})):t("div",{className:"clib-hint"},R?.note||e("binaryPreview")):pe?t("div",{className:"clib-hint"},e("binaryPreview")):_?t("div",{className:"clib-code-wrap"},t("pre",{className:"clib-code-gutter"},ne.map((f,y)=>y+1).join(`
`)),t("pre",{className:"clib-code"},ne.join(`
`))):null),O?t("div",{className:"clib-confirm"},t("b",null,O==="purge"?j(e("purgeConfirm"),{title:l.title}):j(e("deleteConfirm"),{title:l.title})),t("p",null,O==="purge"?e("purgeConfirmBody"):`${e("deleteConfirmBody")}${l.storage==="linked"?` ${e("deleteConfirmLinked")}`:""}`),t("div",{className:"clib-confirm-row"},t("button",{type:"button",className:"clib-btn",onClick:()=>V(""),disabled:!!k},e("cancel")),t("button",{type:"button",className:"clib-btn is-danger",onClick:$,disabled:!!k},e(k?"deleting":O==="purge"?"purge":"delete")))):null);let ye=t("div",{className:"clib-detail-foot"},E?t(o.default.Fragment,null,t("button",{type:"button",className:"clib-btn is-primary",disabled:!!k,onClick:J},t(h,{name:"restore",size:13}),e("restore")),t("span",{className:"clib-grow"}),t("button",{type:"button",className:"clib-btn is-danger",disabled:!!k,onClick:()=>V("purge")},t(h,{name:"trash",size:13}),e("purge"))):t(o.default.Fragment,null,t("button",{type:"button",className:"clib-btn is-primary",disabled:!!k||!ve,onClick:A},t(h,{name:"save",size:13}),e(k==="save"?"saving":"save")),t("button",{type:"button",className:"clib-btn",disabled:!l?.path||!!k,title:l?.path?l.path:e("noPath"),onClick:()=>K(l?.path??"","path")},t(h,{name:"copy",size:13}),e("copyPath")),t("button",{type:"button",className:"clib-btn",disabled:!l?.path||!!k,title:l?.path?e("revealInFinder"):e("noPath"),onClick:le},t(h,{name:"folder",size:13}),e(k==="reveal"?"revealing":"revealInFinder")),t("button",{type:"button",className:"clib-btn",disabled:!_||!!k,onClick:()=>K(_,"content")},t(h,{name:"copy",size:12}),e("copyContent")),t("span",{className:"clib-grow"}),t("button",{type:"button",className:"clib-btn is-danger",disabled:!!k||!l,onClick:()=>V("delete")},t(h,{name:"trash",size:13}),e("delete"))));return t("aside",{className:"clib-detail is-open"},be,t("div",{className:"clib-detail-body"},Y),ye)}function Pt({t:e,defaultCollection:i,busy:a,onClose:n,onCreate:c}){let[u,p]=o.default.useState(""),[x,N]=o.default.useState("");return o.default.useEffect(()=>{let d=w=>{w.key==="Escape"&&n()};return window.addEventListener("keydown",d),()=>window.removeEventListener("keydown",d)},[n]),t("div",{className:"clib-overlay",onMouseDown:d=>{d.target===d.currentTarget&&n()}},t("form",{className:"clib-dialog",onSubmit:d=>{d.preventDefault(),a||c({title:u,content:x})}},t("h3",null,e("newNote")),t("input",{className:"clib-input",value:u,placeholder:e("noteTitlePlaceholder"),"aria-label":e("noteTitlePlaceholder"),autoFocus:!0,onChange:d=>p(d.target.value)}),t("textarea",{className:"clib-textarea",value:x,placeholder:e("noteContentPlaceholder"),"aria-label":e("noteContentPlaceholder"),onChange:d=>N(d.target.value)}),t("div",{className:"clib-dialog-actions"},t("button",{type:"button",className:"clib-btn",onClick:n,disabled:a},e("cancel")),t("button",{type:"submit",className:"clib-btn is-primary",disabled:a},e(a?"creating":"create")))))}function It({t:e,toasts:i,onDismiss:a}){return t("div",{className:"clib-toasts"},i.map(n=>t("div",{key:n.id,className:`clib-toast is-${n.type??"ok"}`,role:"status"},t("div",{className:"clib-toast-top"},t("span",{className:"clib-toast-title"},n.title??""),t("button",{type:"button",className:"clib-toast-close",onClick:()=>a(n.id),title:e("close"),"aria-label":e("close")},t(h,{name:"close",size:11}))),n.message?t("div",{className:"clib-toast-body"},n.message):null,n.lines?.length?t("div",{className:"clib-toast-body"},n.lines.map((c,u)=>t("div",{key:u,className:`clib-toast-line${c.bad?" is-bad":""}`},c.text))):null)))}var Lt=0;function at({t:e,onExit:i}){let[a,n]=o.default.useState(null),[c,u]=o.default.useState([]),[p,x]=o.default.useState([]),[N,d]=o.default.useState(0),[w,L]=o.default.useState(null),[l,P]=o.default.useState(!0),[S,C]=o.default.useState(!1),[m,Z]=o.default.useState(!1),[r,Q]=o.default.useState(!1),[ce,H]=o.default.useState(null),[k,I]=o.default.useState(!1),[O,V]=o.default.useState(!1),[se,ee]=o.default.useState(""),[R,te]=o.default.useState(""),[ie,ae]=o.default.useState(""),[E,ve]=o.default.useState("relevance"),[B,_]=o.default.useState("active"),[U,ne]=o.default.useState(""),[q,de]=o.default.useState(""),[G,pe]=o.default.useState(""),X=o.default.useRef(0),W=o.default.useRef(p);o.default.useEffect(()=>{W.current=p},[p]);let A=o.default.useCallback(s=>{let g=++Lt;u(z=>[...z.slice(-3),{id:g,...s}]);let v=s.ttl??(s.type==="error"?6500:3800);v>0&&setTimeout(()=>u(z=>z.filter(oe=>oe.id!==g)),v)},[]),$=o.default.useCallback(s=>{A({type:"error",title:e("errorPrefix"),message:s?.message??String(s??"")})},[A,e]);o.default.useEffect(()=>{let s=setTimeout(()=>te(se.trim()),250);return()=>clearTimeout(s)},[se]);let J=o.default.useCallback(async()=>{try{n(await Ee())}catch(s){$(s)}},[$]),K=o.default.useCallback(async s=>{let g=++X.current;s?C(!0):P(!0);let v=s?W.current.length:0;try{let z=B==="trashed"?await We({limit:Xe,offset:v}):await $e({q:R,kind:ie,collection:q,tag:G,source:U,sort:E,status:"active",limit:Xe,offset:v});if(g!==X.current)return;let oe=z?.items??[];x(M=>s?[...M,...oe]:oe),d(z?.total??0),!s&&z?.facets&&L(z.facets)}catch(z){g===X.current&&$(z)}finally{g===X.current&&(P(!1),C(!1))}},[B,R,ie,q,G,U,E,$]);o.default.useEffect(()=>{H(null),K(!1)},[K]),o.default.useEffect(()=>{J()},[J]);let le=o.default.useMemo(()=>{let s=a?.sources??[],g=new Map((a?.stats?.sources??[]).map(v=>[v.id,v]));return s.length?s.map(v=>{let z=g.get(v.id);return{...v,count:z?.count??v.count??0,lastScanAt:z?.lastScanAt??v.lastScanAt}}):a?.stats?.sources??[]},[a]),be=o.default.useMemo(()=>{let s={};for(let g of le)s[g.id]=g.name;return s},[le]),Y=w?.collections??a?.stats?.collections??[],ye=w?.tags??a?.stats?.tags??[],f=a?.trashCount??0,y=!!(R||ie||q||G||U);async function F(){Z(!0);try{await Promise.all([J(),K(!1)])}finally{Z(!1)}}async function D(){if(!r){Q(!0);try{let s=await _e({}),g=s?.results??s??[];if(!g?.length)A({type:"warn",title:e("scanDone"),message:e("scanNoSources")});else{let v=[],z=!1;for(let M of g){let Ne=M.errors?.length??0;Ne&&(z=!0),v.push({text:j(e("scanResult"),{name:be[M.sourceId]??M.sourceId??"?",added:M.added??0,updated:M.updated??0,removed:M.removed??0,skipped:M.skipped??0,errors:Ne}),bad:Ne>0})}let oe=g.flatMap(M=>M.errors??[]).slice(0,3).map(M=>({text:j(e("scanErrorLine"),{path:M.path??"",message:M.message??""}),bad:!0}));A({type:z?"warn":"ok",title:e("scanDone"),lines:[...v,...oe],ttl:9e3})}await F()}catch(s){$(s)}finally{Q(!1)}}}async function ue(s){try{let g=await qe(s);return await J(),A({type:"ok",title:j(e("sourceAdded"),{name:g?.source?.name??s.name})}),!0}catch(g){return $(g),!1}}async function me(s){if(window.confirm(j(e("removeSourceConfirm"),{name:s.name})))try{await Ge(s.id),U===s.id&&ne(""),await Promise.all([J(),K(!1)]),A({type:"ok",title:e("sourceRemoved")})}catch(v){$(v)}}async function we(s){if(!O){V(!0);try{let g=await je({title:s.title.trim()||e("untitled"),content:s.content,kind:"note",collection:q||"inbox",tags:G?[G]:[]}),v=g?.item??g;I(!1),A({type:"ok",title:e("noteCreated")}),await F(),v?.id&&H(v.id)}catch(g){$(g)}finally{V(!1)}}}function ke(s){B!=="trashed"&&("source"in s&&ne(s.source),"collection"in s&&de(s.collection),"tag"in s&&pe(s.tag))}function rt(){ee(""),te(""),ae(""),de(""),pe(""),ne("")}function ct(){_(s=>s==="trashed"?"active":"trashed"),H(null)}return t("div",{className:"clib-root"},t(kt,{t:e,qInput:se,onQuery:ee,onExit:i,kind:ie,onKind:ae,sort:E,onSort:ve,status:B,trashCount:f,onToggleTrash:ct,onScan:D,scanning:r,onNewNote:()=>I(!0),onRefresh:F,refreshing:m}),t("div",{className:"clib-body"},t(Nt,{t:e,sources:le,collections:Y,tags:ye,filters:{source:U,collection:q,tag:G},disabled:B==="trashed",onFilter:ke,onAddSource:ue,onRemoveSource:me}),t(zt,{t:e,items:p,total:N,loading:l,moreLoading:S,selectedId:ce,onSelect:H,onLoadMore:()=>K(!0),status:B,hasFilters:y,onClearFilters:rt,sourceNames:be,onNewNote:()=>I(!0)}),t(Mt,{t:e,id:ce,collections:Y,sourceNames:be,onClose:()=>H(null),onChanged:F,pushToast:A,toastError:$})),k?t(Pt,{t:e,defaultCollection:q,busy:O,onClose:()=>I(!1),onCreate:we}):null,t(It,{t:e,toasts:c,onDismiss:s=>u(g=>g.filter(v=>v.id!==s))}))}var Et=String.raw`
.clib-root{
  --clib-ink: var(--dsw-alias-label-primary, #1f2328);
  --clib-ink2: var(--dsw-alias-label-secondary, #5b6470);
  --clib-ink3: color-mix(in srgb, var(--clib-ink2) 72%, transparent);
  --clib-bg: var(--dsw-alias-bg-base, #ffffff);
  --clib-card: var(--dsw-alias-bg-layer-2, #f6f7f9);
  --clib-layer: var(--dsw-alias-bg-layer-1, #f1f3f6);
  --clib-line: var(--dsw-alias-border-l1, #e3e6ea);
  --clib-line-strong: var(--dsw-alias-border-l2, #cdd3da);
  --clib-accent: var(--dsw-alias-brand-primary, #3a5bd9);
  --clib-danger: var(--dsw-alias-state-error-primary, #c8332b);
  --clib-ok: var(--dsw-alias-state-success-primary, #0f8f6d);
  --clib-warn: var(--dsw-alias-state-warning-primary, #b1661b);
  --clib-hover: color-mix(in srgb, var(--clib-ink) 7%, transparent);
  --clib-active: color-mix(in srgb, var(--clib-accent) 13%, transparent);
  --clib-r: var(--dsw-radius-sm, 8px);
  --clib-r-lg: var(--dsw-radius-md, 12px);
  --clib-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  background: var(--clib-bg); color: var(--clib-ink);
  font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased;
}
html[data-theme='dark'] .clib-root, body[data-ds-dark-theme] .clib-root{
  --clib-ink: var(--dsw-alias-label-primary, #e6e8ea);
  --clib-ink2: var(--dsw-alias-label-secondary, #9aa2ac);
  --clib-bg: var(--dsw-alias-bg-base, #17191c);
  --clib-card: var(--dsw-alias-bg-layer-2, #202327);
  --clib-layer: var(--dsw-alias-bg-layer-1, #1c1f22);
  --clib-line: var(--dsw-alias-border-l1, #2d3136);
  --clib-line-strong: var(--dsw-alias-border-l2, #3b4046);
  --clib-accent: var(--dsw-alias-brand-primary, #7d95ff);
  --clib-danger: var(--dsw-alias-state-error-primary, #ff6b60);
  --clib-ok: var(--dsw-alias-state-success-primary, #3fc79a);
  --clib-warn: var(--dsw-alias-state-warning-primary, #e0a04a);
  color-scheme: dark;
}
.clib-root *, .clib-root *::before, .clib-root *::after{ box-sizing: border-box; }
.clib-root button, .clib-root input, .clib-root select, .clib-root textarea{ font: inherit; color: inherit; }
.clib-root button{ cursor: pointer; }
.clib-root ::selection{ background: color-mix(in srgb, var(--clib-accent) 28%, transparent); }
.clib-root ::-webkit-scrollbar{ width: 10px; height: 10px; }
.clib-root ::-webkit-scrollbar-thumb{ background: color-mix(in srgb, var(--clib-ink) 18%, transparent); border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
.clib-root ::-webkit-scrollbar-thumb:hover{ background-color: color-mix(in srgb, var(--clib-ink) 30%, transparent); }

/* ---------------------------------------------------------------- 顶栏 */
.clib-toolbar{
  flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 10px 14px; border-bottom: .5px solid var(--clib-line);
  background: color-mix(in srgb, var(--clib-bg) 90%, transparent);
  backdrop-filter: blur(18px) saturate(160%); z-index: 6;
}
.clib-brand{ display: flex; flex-direction: column; gap: 1px; margin-right: 4px; min-width: 92px; }
.clib-brand b{ font-size: 13.5px; font-weight: 650; letter-spacing: .2px; }
.clib-brand small{ font-size: 10.5px; color: var(--clib-ink3); }
.clib-search{
  flex: 1 1 220px; min-width: 170px; display: flex; align-items: center; gap: 6px;
  padding: 0 9px; height: 30px; border: .5px solid var(--clib-line); border-radius: 999px;
  background: var(--clib-card); color: var(--clib-ink3);
}
.clib-search:focus-within{ border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 20%, transparent); }
.clib-search input{ flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--clib-ink); height: 100%; }
.clib-search input::placeholder{ color: var(--clib-ink3); }
.clib-select, .clib-input, .clib-textarea{
  font: inherit; color: var(--clib-ink); background: var(--clib-card); border: .5px solid var(--clib-line);
  border-radius: var(--clib-r); padding: 5px 8px; outline: none;
}
.clib-select{ height: 30px; cursor: pointer; max-width: 150px; }
.clib-select:hover, .clib-input:hover, .clib-textarea:hover{ border-color: var(--clib-line-strong); }
.clib-select:focus-visible, .clib-input:focus-visible, .clib-textarea:focus-visible{
  border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 20%, transparent);
}
.clib-btn{
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 5px 10px; height: 30px; border-radius: 999px; border: .5px solid var(--clib-line);
  background: transparent; color: var(--clib-ink); font-size: 12px; white-space: nowrap;
  transition: background .16s ease, border-color .16s ease, transform .12s ease;
}
.clib-btn:hover{ background: var(--clib-hover); border-color: var(--clib-line-strong); }
.clib-btn:active{ transform: scale(.97); }
.clib-btn[disabled]{ opacity: .45; cursor: not-allowed; transform: none; }
.clib-btn.is-primary{ background: var(--clib-accent); border-color: transparent; color: #fff; }
.clib-btn.is-primary:hover{ background: var(--clib-accent); filter: brightness(1.06); }
.clib-btn.is-danger{ color: var(--clib-danger); border-color: color-mix(in srgb, var(--clib-danger) 42%, transparent); }
.clib-btn.is-danger:hover{ background: color-mix(in srgb, var(--clib-danger) 12%, transparent); }
.clib-btn.is-on{ background: var(--clib-active); border-color: color-mix(in srgb, var(--clib-accent) 38%, transparent); color: var(--clib-accent); }
.clib-icon{ width: 28px; height: 28px; padding: 0; border-radius: 8px; }
.clib-spin{ animation: clib-spin 1s linear infinite; }
@keyframes clib-spin{ to{ transform: rotate(360deg); } }

/* ---------------------------------------------------------------- 三栏 */
.clib-body{ flex: 1; min-height: 0; display: grid; grid-template-columns: 214px minmax(0, 1fr) minmax(320px, 408px); }
.clib-side{
  min-height: 0; overflow-y: auto; padding: 12px 10px 18px;
  border-right: .5px solid var(--clib-line); background: color-mix(in srgb, var(--clib-layer) 55%, transparent);
}
.clib-side-title{
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  margin: 12px 6px 5px; font-size: 10.5px; font-weight: 650; letter-spacing: .7px;
  text-transform: uppercase; color: var(--clib-ink3);
}
.clib-side-title:first-child{ margin-top: 0; }
.clib-nav{
  width: 100%; display: flex; align-items: center; gap: 7px; padding: 5px 7px;
  border: 0; border-radius: 7px; background: transparent; text-align: left;
  font-size: 12.5px; color: var(--clib-ink2); line-height: 1.35;
}
.clib-nav:hover{ background: var(--clib-hover); color: var(--clib-ink); }
.clib-nav.is-on{ background: var(--clib-active); color: var(--clib-accent); font-weight: 600; }
.clib-nav .clib-nav-label{ flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clib-nav .clib-count{ flex: none; font-size: 10.5px; color: var(--clib-ink3); font-variant-numeric: tabular-nums; }
.clib-nav.is-on .clib-count{ color: inherit; opacity: .8; }
.clib-nav .clib-dot{ flex: none; width: 6px; height: 6px; border-radius: 2px; background: color-mix(in srgb, var(--clib-ink2) 55%, transparent); }
.clib-nav.is-on .clib-dot{ background: var(--clib-accent); }

.clib-tagcloud{ display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 4px; }
.clib-tag{
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 2px 8px; border-radius: 999px; border: .5px solid var(--clib-line);
  background: transparent; font-size: 11px; color: var(--clib-ink2); overflow: hidden;
}
.clib-tag span{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clib-tag:hover{ border-color: var(--clib-line-strong); color: var(--clib-ink); background: var(--clib-hover); }
.clib-tag.is-on{ background: var(--clib-active); border-color: color-mix(in srgb, var(--clib-accent) 40%, transparent); color: var(--clib-accent); }
.clib-tag em{ font-style: normal; font-size: 9.5px; opacity: .65; font-variant-numeric: tabular-nums; }
.clib-side-empty{ margin: 2px 6px; font-size: 11px; color: var(--clib-ink3); }

.clib-source-form{ display: flex; flex-direction: column; gap: 5px; margin: 6px 4px 0; }
.clib-source-form .clib-input{ width: 100%; font-size: 11.5px; padding: 4px 7px; }
.clib-source-form-row{ display: flex; gap: 5px; }
.clib-source-form-row .clib-btn{ flex: 1; height: 26px; font-size: 11px; }
.clib-side-add{ margin-left: auto; border: 0; background: transparent; color: var(--clib-ink3); font-size: 11px; padding: 0 4px; }
.clib-side-add:hover{ color: var(--clib-accent); }
.clib-source-row{ position: relative; }
.clib-source-row .clib-source-remove{
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--clib-ink3); display: none; align-items: center; justify-content: center;
}
.clib-source-row:hover .clib-source-remove{ display: inline-flex; }
.clib-source-row .clib-source-remove:hover{ background: var(--clib-hover); color: var(--clib-danger); }
.clib-missing{ color: var(--clib-warn); font-size: 10px; }

/* ---------------------------------------------------------------- 列表 */
.clib-main{ min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--clib-bg); }
.clib-list-head{
  flex: none; display: flex; align-items: center; gap: 8px; justify-content: space-between;
  padding: 8px 14px; border-bottom: .5px solid var(--clib-line); min-height: 36px;
  font-size: 11.5px; color: var(--clib-ink3);
}
.clib-list-head b{ color: var(--clib-ink2); font-weight: 600; font-variant-numeric: tabular-nums; }
.clib-list{ flex: 1; min-height: 0; overflow-y: auto; }
.clib-row{
  width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px;
  border: 0; border-bottom: .5px solid var(--clib-line); background: transparent;
  text-align: left; color: inherit; position: relative; transition: background .12s ease;
}
.clib-row:hover{ background: var(--clib-hover); }
.clib-row.is-on{ background: var(--clib-active); }
.clib-row.is-on::before{ content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2.5px; background: var(--clib-accent); }
.clib-row-icon{
  flex: none; width: 28px; height: 28px; margin-top: 1px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--clib-card); color: var(--clib-ink2); border: .5px solid var(--clib-line);
}
.clib-row.is-on .clib-row-icon{ color: var(--clib-accent); border-color: color-mix(in srgb, var(--clib-accent) 30%, transparent); }
.clib-row-body{ flex: 1; min-width: 0; }
.clib-row-title{ display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.clib-row-title strong{ font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clib-badge{
  flex: none; font-size: 9.5px; line-height: 1.6; padding: 0 6px; border-radius: 999px;
  background: var(--clib-card); border: .5px solid var(--clib-line); color: var(--clib-ink3);
}
.clib-row-meta{
  display: flex; align-items: center; gap: 7px; margin-top: 1px;
  font-size: 10.5px; color: var(--clib-ink3); min-width: 0;
}
.clib-row-meta .clib-path{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.clib-row-meta .clib-sep{ flex: none; opacity: .5; }
.clib-row-meta .clib-num{ flex: none; font-variant-numeric: tabular-nums; }
.clib-row-snippet{
  margin-top: 3px; font-size: 11.5px; color: var(--clib-ink2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word;
}
.clib-row-tags{ display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.clib-mini-tag{ font-size: 9.5px; padding: 0 5px; border-radius: 4px; background: var(--clib-card); color: var(--clib-ink3); }
.clib-list-foot{ flex: none; display: flex; justify-content: center; padding: 10px; border-top: .5px solid var(--clib-line); }

.clib-empty{
  flex: 1; min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 32px; text-align: center; color: var(--clib-ink2);
}
.clib-empty-icon{
  width: 46px; height: 46px; border-radius: 14px; display: flex; align-items: center; justify-content: center;
  background: var(--clib-card); border: .5px solid var(--clib-line); color: var(--clib-ink3); margin-bottom: 2px;
}
.clib-empty b{ font-size: 14px; color: var(--clib-ink); }
.clib-empty p{ margin: 0; max-width: 320px; font-size: 12px; color: var(--clib-ink3); }

.clib-skel{ padding: 13px 14px; border-bottom: .5px solid var(--clib-line); display: flex; gap: 10px; }
.clib-skel-avatar{ width: 28px; height: 28px; border-radius: 8px; flex: none; }
.clib-skel-lines{ flex: 1; display: flex; flex-direction: column; gap: 6px; }
.clib-skel-line{ height: 9px; border-radius: 5px; }
.clib-shimmer{
  background: linear-gradient(90deg, var(--clib-card) 25%, var(--clib-layer) 37%, var(--clib-card) 63%);
  background-size: 400% 100%; animation: clib-shimmer 1.3s ease infinite;
}
@keyframes clib-shimmer{ 0%{ background-position: 100% 50%; } 100%{ background-position: 0 50%; } }

/* ---------------------------------------------------------------- 详情 */
.clib-detail{
  min-width: 0; min-height: 0; display: flex; flex-direction: column;
  border-left: .5px solid var(--clib-line); background: var(--clib-bg);
}
.clib-detail-head{
  flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px 8px;
  border-bottom: .5px solid var(--clib-line);
}
.clib-detail-head .clib-detail-titles{ flex: 1; min-width: 0; }
.clib-detail-head h2{ margin: 0; font-size: 14px; font-weight: 650; line-height: 1.35; word-break: break-word; }
.clib-detail-sub{ margin-top: 2px; font-size: 10.5px; color: var(--clib-ink3); display: flex; flex-wrap: wrap; gap: 5px 8px; align-items: center; }
.clib-detail-body{ flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 12px; }
.clib-detail-foot{
  flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 7px;
  padding: 9px 14px; border-top: .5px solid var(--clib-line);
  background: color-mix(in srgb, var(--clib-bg) 92%, transparent); backdrop-filter: blur(10px);
}
.clib-detail-foot .clib-grow{ flex: 1; }
.clib-placeholder{
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 30px; text-align: center; color: var(--clib-ink3);
}
.clib-placeholder b{ color: var(--clib-ink2); font-size: 13px; }
.clib-placeholder p{ margin: 0; max-width: 240px; font-size: 11.5px; }

.clib-field{ display: flex; flex-direction: column; gap: 4px; }
.clib-field > label{ display: flex; align-items: baseline; justify-content: space-between; gap: 6px; font-size: 10.5px; font-weight: 650; letter-spacing: .4px; text-transform: uppercase; color: var(--clib-ink3); }
.clib-field > label small{ font-weight: 400; text-transform: none; letter-spacing: 0; opacity: .8; }
.clib-field .clib-input, .clib-field .clib-textarea{ width: 100%; }
.clib-textarea{ resize: vertical; min-height: 58px; line-height: 1.5; }
.clib-path-line{ font-family: var(--clib-mono); font-size: 10.5px; color: var(--clib-ink3); word-break: break-all; }
.clib-path-row{ display: flex; align-items: flex-start; gap: 4px; }
.clib-path-row .clib-path-line{ flex: 1; min-width: 0; }
.clib-icon-btn{
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; border: .5px solid var(--clib-line); border-radius: 5px;
  background: var(--clib-card); color: var(--clib-ink3); cursor: pointer; line-height: 1;
}
.clib-icon-btn:hover{ color: var(--clib-ink); border-color: var(--clib-ink3); }
.clib-icon-btn:disabled{ opacity: .45; cursor: default; }
.clib-chips{ display: flex; flex-wrap: wrap; gap: 4px; }

.clib-preview{ display: flex; flex-direction: column; gap: 5px; }
.clib-preview-head{ display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10.5px; color: var(--clib-ink3); }
.clib-code-wrap{
  display: flex; max-height: 330px; overflow: auto; border: .5px solid var(--clib-line);
  border-radius: var(--clib-r); background: var(--clib-card); font-family: var(--clib-mono); font-size: 11px; line-height: 1.6;
}
.clib-code-gutter{
  flex: none; padding: 8px 6px 8px 8px; text-align: right; color: var(--clib-ink3);
  background: color-mix(in srgb, var(--clib-ink) 4%, transparent);
  border-right: .5px solid var(--clib-line); user-select: none; font-variant-numeric: tabular-nums;
}
.clib-code{
  margin: 0; padding: 8px 10px 8px 8px; white-space: pre; color: var(--clib-ink);
  font-family: inherit; font-size: inherit; line-height: inherit; flex: 1;
}
.clib-image-wrap{
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); overflow: hidden;
  background-color: var(--clib-card);
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--clib-ink) 6%, transparent) 25%, transparent 25%),
    linear-gradient(-45deg, color-mix(in srgb, var(--clib-ink) 6%, transparent) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--clib-ink) 6%, transparent) 75%),
    linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--clib-ink) 6%, transparent) 75%);
  background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  display: flex; align-items: center; justify-content: center; min-height: 120px; padding: 6px;
}
.clib-image-wrap img{ max-width: 100%; max-height: 340px; object-fit: contain; display: block; }
.clib-doc-text{
  display: flex; flex-direction: column; gap: 4px; max-height: 330px; overflow: auto;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
  font-family: var(--clib-mono); font-size: 11px; line-height: 1.6;
}
.clib-doc-text .clib-code{ white-space: pre-wrap; word-break: break-word; }
.clib-hint{
  padding: 8px 10px; border-radius: var(--clib-r); background: var(--clib-card);
  border: .5px solid var(--clib-line); color: var(--clib-ink3); font-size: 11.5px;
}
.clib-confirm{
  display: flex; flex-direction: column; gap: 7px; padding: 10px;
  border-radius: var(--clib-r); border: .5px solid color-mix(in srgb, var(--clib-danger) 40%, transparent);
  background: color-mix(in srgb, var(--clib-danger) 7%, transparent);
}
.clib-confirm b{ font-size: 12px; color: var(--clib-ink); }
.clib-confirm p{ margin: 0; font-size: 11.5px; color: var(--clib-ink2); }
.clib-confirm-row{ display: flex; gap: 7px; justify-content: flex-end; }

/* ---------------------------------------------------------------- 弹窗 / toast */
.clib-overlay{
  position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  padding: 20px; background: rgb(0 0 0 / .32); backdrop-filter: blur(2px);
}
.clib-dialog{
  width: min(520px, 100%); max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 10px;
  padding: 16px; border-radius: var(--clib-r-lg); border: .5px solid var(--clib-line);
  background: var(--clib-bg); box-shadow: 0 20px 60px rgb(0 0 0 / .22);
}
.clib-dialog h3{ margin: 0; font-size: 14px; font-weight: 650; }
.clib-dialog textarea{ min-height: 190px; font-family: var(--clib-mono); font-size: 12px; }
.clib-dialog-actions{ display: flex; justify-content: flex-end; gap: 7px; }

.clib-toasts{
  position: fixed; top: 14px; right: 14px; z-index: 80; display: flex; flex-direction: column; gap: 8px;
  width: min(420px, calc(100vw - 28px)); pointer-events: none;
}
.clib-toast{
  pointer-events: auto; padding: 9px 10px 9px 12px; border-radius: 10px;
  border: .5px solid var(--clib-line); border-left: 3px solid var(--clib-accent);
  background: var(--clib-bg); color: var(--clib-ink);
  box-shadow: 0 10px 34px rgb(0 0 0 / .16); font-size: 12px;
  animation: clib-toast-in .18s ease-out;
}
.clib-toast.is-error{ border-left-color: var(--clib-danger); }
.clib-toast.is-warn{ border-left-color: var(--clib-warn); }
.clib-toast.is-ok{ border-left-color: var(--clib-ok); }
.clib-toast-top{ display: flex; align-items: flex-start; gap: 8px; }
.clib-toast-title{ flex: 1; font-weight: 600; }
.clib-toast-close{
  flex: none; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--clib-ink3); display: inline-flex; align-items: center; justify-content: center;
}
.clib-toast-close:hover{ background: var(--clib-hover); color: var(--clib-ink); }
.clib-toast-body{ margin-top: 3px; color: var(--clib-ink2); white-space: pre-wrap; word-break: break-word; }
.clib-toast-line{ font-size: 11.5px; line-height: 1.45; }
.clib-toast-line.is-bad{ color: var(--clib-danger); }
@keyframes clib-toast-in{ from{ opacity: 0; transform: translateY(-6px); } to{ opacity: 1; transform: none; } }

/* ---------------------------------------------------------------- 窄屏 */
@media (max-width: 1080px){
  .clib-body{ grid-template-columns: 188px minmax(0, 1fr) minmax(290px, 350px); }
}
@media (max-width: 900px){
  .clib-body{ grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); }
  .clib-side{ display: none; }
}
@media (max-width: 720px){
  .clib-body{ grid-template-columns: minmax(0, 1fr); position: relative; }
  .clib-detail{ position: absolute; inset: 0; z-index: 7; display: none; }
  .clib-detail.is-open{ display: flex; }
  .clib-list-head{ padding: 7px 10px; }
  .clib-toolbar{ padding: 8px 10px; }
  .clib-brand small{ display: none; }
}
`;function nt(e=document){let i="clib-styles";e.getElementById(i)?.remove();let a=e.createElement("style");return a.id=i,a.textContent=Et,e.head.appendChild(a),()=>a.remove()}var lt="context-lib",ot="context-lib",xe={t:e=>e},Me=()=>{};function $t({size:e=16}){return re.default.createElement("svg",{width:e,height:e,viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:1.4,strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0},re.default.createElement("path",{d:"M2 3.2h3.7c1.2 0 2.2.7 2.3 1.8v8c-.4-1.1-1.4-1.8-2.6-1.8H2z"}),re.default.createElement("path",{d:"M8 5c.1-1.1 1.1-1.8 2.3-1.8H14v8h-3.7c-1.2 0-2.2.7-2.6 1.8"}),re.default.createElement("path",{d:"M3 6.4h2.6M3 8.8h2.6"}))}function Ft(){return re.default.createElement(at,{t:xe.t,onExit:Me})}function Dt(e){xe.t=typeof e.locale?.bind=="function"?e.locale.bind(lt):a=>a,Me=()=>{try{let a=e.get("layout");typeof a?.selectPanel=="function"&&a.selectPanel(null)}catch(a){console.error("[context-lib] \u8FD4\u56DE\u5BF9\u8BDD\u5931\u8D25\uFF1A",a)}},e.effect(()=>e.locale.register(lt,{zh:Ye,en:Qe}),"context-lib: dictionaries"),e.effect(()=>nt(document),"context-lib: styles"),e.effect(()=>()=>{xe={t:a=>a},Me=()=>{}},"context-lib: teardown");let i=(a,n)=>{try{n()}catch(c){console.error(`[context-lib] ${a} \u6CE8\u518C\u5931\u8D25\uFF1A`,c)}};i("\u4FA7\u680F\u5165\u53E3",()=>e.slots.inject("sidebar.panellist",()=>e.slots.register({name:"sidebar.panellist",id:ot,order:7,label:()=>xe.t("panelTitle")},$t))),i("\u4E3B\u9875\u9762",()=>e.slots.inject("main",()=>e.slots.register({name:"main",key:ot},Ft)))}var Rt=["slots","locale"];

    return module.exports;
  },
});
