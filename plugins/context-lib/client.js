window.__ModuleLoader__.load({
  id: "dsh-context-lib",
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
var Di=Object.create;var Ie=Object.defineProperty;var Bi=Object.getOwnPropertyDescriptor;var ji=Object.getOwnPropertyNames;var Hi=Object.getPrototypeOf,Ui=Object.prototype.hasOwnProperty;var Vi=(e,t)=>{for(var a in t)Ie(e,a,{get:t[a],enumerable:!0})},ai=(e,t,a,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let l of ji(t))!Ui.call(e,l)&&l!==a&&Ie(e,l,{get:()=>t[l],enumerable:!(n=Bi(t,l))||n.enumerable});return e};var Oe=(e,t,a)=>(a=e!=null?Di(Hi(e)):{},ai(t||!e||!e.__esModule?Ie(a,"default",{value:e,enumerable:!0}):a,e)),Ki=e=>ai(Ie({},"__esModule",{value:!0}),e);var St={};Vi(St,{apply:()=>kt,inject:()=>Nt});module.exports=Ki(St);var Ae=Oe(require("react"),1);var o=Oe(require("react"),1);var Je="/api/context-lib";function De(e){let t=new URLSearchParams;for(let[n,l]of Object.entries(e??{}))l==null||l===""||t.set(n,String(l));let a=t.toString();return a?`?${a}`:""}function li(e,t,a){let n=new Error(String(e));return n.code=t?.error?.code,n.hint=t?.error?.hint,n.status=a,n}async function B(e,t={}){let{method:a="GET",body:n,signal:l,headers:b}=t,m={method:a,signal:l,credentials:"same-origin",headers:{accept:"application/json",...b??{}}};n!==void 0&&(m.headers["content-type"]="application/json",m.body=JSON.stringify(n));let p;try{p=await fetch(Je+e,m)}catch(y){throw y?.name==="AbortError"?y:li(`\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF1A${y?.message??"\u672A\u77E5\u9519\u8BEF"}`,null,0)}let S=await p.text(),f=null;try{f=S?JSON.parse(S):null}catch{f=null}if(!p.ok||f?.ok===!1){let y=f?.error?.message??f?.message??(S&&!f?S:`HTTP ${p.status}`);throw li(y,f,p.status)}return f&&typeof f=="object"&&"ok"in f?f.data:f}function si(e){return B("/state",e)}function ni(e={},t={}){return B(`/items${De(e)}`,t)}function ri(e,t){return B(`/items/${encodeURIComponent(e)}`,t)}function oi(e,{maxChars:t,startLine:a,endLine:n,signal:l}={}){return B(`/items/${encodeURIComponent(e)}/content${De({maxChars:t,startLine:a,endLine:n})}`,{signal:l})}function ci(e){return`${Je}/items/${encodeURIComponent(e)}/raw`}function di(e,{maxChars:t,signal:a}={}){return B(`/items/${encodeURIComponent(e)}/preview${De({maxChars:t})}`,{signal:a})}function Be(e){return`${Je}/items/${encodeURIComponent(e)}/thumb`}function bi(e,t){return B("/items",{...t,method:"POST",body:e})}function Ee(e,t,a){return B(`/items/${encodeURIComponent(e)}`,{...a,method:"PATCH",body:t})}function pi(e,t){return B(`/items/${encodeURIComponent(e)}`,{...t,method:"DELETE"})}function ui(e,t){return B(`/items/${encodeURIComponent(e)}/restore`,{...t,method:"POST"})}function mi(e,t){return B(`/items/${encodeURIComponent(e)}/purge`,{...t,method:"DELETE"})}function gi(e,t){return B(`/items/${encodeURIComponent(e)}/reveal`,{...t,method:"POST"})}function fi({sourceId:e,force:t=!1}={},a){return B("/scan",{...a,method:"POST",body:{sourceId:e,force:t}})}function hi(e,t){return B("/sources",{...t,method:"POST",body:e})}function xi(e,t){return B(`/sources/${encodeURIComponent(e)}`,{...t,method:"DELETE"})}function vi({limit:e=50,offset:t=0}={},a){return B(`/trash${De({limit:e,offset:t})}`,a)}function yi(e){return B("/assist/status",e)}function je(e,t){return B("/assist",{...t,method:"POST",body:e})}var ki={panelTitle:"\u8D44\u6E90\u5E93",appTitle:"\u8D44\u6E90\u5E93",appSub:"\u6587\u6863 / \u811A\u672C / \u56FE\u7247\uFF0C\u4E00\u5904\u68C0\u7D22",searchPlaceholder:"\u68C0\u7D22\u6807\u9898\u3001\u6807\u7B7E\u3001\u8DEF\u5F84\u3001\u6B63\u6587\u2026",kindAll:"\u5168\u90E8\u7C7B\u578B",kindDoc:"\u6587\u6863",kindScript:"\u811A\u672C",kindImage:"\u56FE\u7247",kindData:"\u6570\u636E",kindSession:"\u4F1A\u8BDD",kindNote:"\u7B14\u8BB0",kindOther:"\u5176\u4ED6",sortLabel:"\u6392\u5E8F",sortRelevance:"\u76F8\u5173\u5EA6",sortUpdated:"\u66F4\u65B0\u65F6\u95F4",sortTitle:"\u6807\u9898",sortSize:"\u5927\u5C0F",scan:"\u626B\u63CF",scanning:"\u626B\u63CF\u4E2D\u2026",newNote:"\u65B0\u5EFA\u7B14\u8BB0",trashToggle:"\u56DE\u6536\u7AD9",refresh:"\u5237\u65B0",backToChat:"\u8FD4\u56DE\u5BF9\u8BDD",sources:"\u6765\u6E90",collections:"\u5F52\u7C7B",tags:"\u6807\u7B7E",allSources:"\u5168\u90E8\u6765\u6E90",allCollections:"\u5168\u90E8\u5F52\u7C7B",addSource:"\u6DFB\u52A0\u6765\u6E90",sourceName:"\u540D\u79F0",sourcePath:"\u8DEF\u5F84\uFF08\u7EDD\u5BF9\u8DEF\u5F84\u6216 ~ \u5F00\u5934\uFF09",add:"\u6DFB\u52A0",removeSource:"\u79FB\u9664\u6765\u6E90",removeSourceConfirm:"\u79FB\u9664\u6765\u6E90\u300C{name}\u300D\uFF1F\u5B83\u7D22\u5F15\u7684\u6761\u76EE\u4E5F\u4F1A\u4E00\u5E76\u79FB\u9664\uFF08\u4E0D\u4F1A\u52A8\u539F\u6587\u4EF6\uFF09\u3002",sourceAdded:"\u5DF2\u6DFB\u52A0\u6765\u6E90\u300C{name}\u300D",sourceRemoved:"\u5DF2\u79FB\u9664\u6765\u6E90",sourceMissing:"\u8DEF\u5F84\u4E0D\u5B58\u5728",unknownSource:"\u672A\u6807\u6CE8\u6765\u6E90",sourceCount:"{n} \u6761",emptyTitle:"\u8D44\u6E90\u5E93\u8FD8\u662F\u7A7A\u7684",emptyBody:"\u70B9\u9876\u90E8\u300C\u626B\u63CF\u300D\u628A\u6765\u6E90\u91CC\u7684\u6587\u4EF6\u6536\u8FDB\u6765\uFF0C\u6216\u8005\u5148\u5199\u4E00\u6761\u7B14\u8BB0\u3002",emptyFiltered:"\u6CA1\u6709\u5339\u914D\u7684\u6761\u76EE",emptyFilteredBody:"\u6362\u4E2A\u5173\u952E\u8BCD\uFF0C\u6216\u8005\u6E05\u6389\u7B5B\u9009\u6761\u4EF6\u518D\u8BD5\u3002",emptyTrash:"\u56DE\u6536\u7AD9\u662F\u7A7A\u7684",emptyTrashBody:"\u5220\u9664\u7684\u6761\u76EE\u4F1A\u5148\u6765\u8FD9\u91CC\uFF0C\u518D\u51B3\u5B9A\u6062\u590D\u8FD8\u662F\u5F7B\u5E95\u5220\u9664\u3002",clearFilters:"\u6E05\u6389\u7B5B\u9009",loading:"\u52A0\u8F7D\u4E2D\u2026",loadMore:"\u52A0\u8F7D\u66F4\u591A",loadingMore:"\u6B63\u5728\u52A0\u8F7D\u2026",totalCount:"\u5171 {n} \u6761",detailEmpty:"\u9009\u4E00\u6761\u67E5\u770B\u8BE6\u60C5",detailEmptyBody:"\u6807\u9898\u3001\u6807\u7B7E\u3001\u5907\u6CE8\u548C\u6B63\u6587\u9884\u89C8\u90FD\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002",loadingDetail:"\u6B63\u5728\u8BFB\u8FD9\u4E00\u6761\u2026",fieldTitle:"\u6807\u9898",fieldCollection:"\u5F52\u7C7B",fieldTags:"\u6807\u7B7E",fieldTagsHint:"\u7528\u9017\u53F7\u5206\u9694",fieldNotes:"\u5907\u6CE8",fieldNotesPlaceholder:"\u7ED9\u8FD9\u6761\u8D44\u6599\u5199\u70B9\u7528\u6CD5\u63D0\u793A\uFF0C\u68C0\u7D22\u65F6\u4E5F\u4F1A\u547D\u4E2D\u2026",fieldContent:"\u6B63\u6587",save:"\u4FDD\u5B58",saving:"\u4FDD\u5B58\u4E2D\u2026",saved:"\u5DF2\u4FDD\u5B58",copyPath:"\u590D\u5236\u8DEF\u5F84",copyContent:"\u590D\u5236\u5185\u5BB9",copied:"\u5DF2\u590D\u5236",copyFailed:"\u590D\u5236\u5931\u8D25\uFF0C\u6D4F\u89C8\u5668\u62D2\u7EDD\u4E86\u526A\u8D34\u677F\u8BBF\u95EE",revealInFinder:"\u5728\u8BBF\u8FBE\u4E2D\u663E\u793A",revealing:"\u6B63\u5728\u6253\u5F00\u8BBF\u8FBE\u2026",revealed:"\u5DF2\u5728\u8BBF\u8FBE\u4E2D\u5B9A\u4F4D",noPath:"\u8FD9\u6761\u6CA1\u6709\u539F\u6587\u4EF6\u8DEF\u5F84\uFF08\u526F\u672C\u6216\u7B14\u8BB0\uFF09",noTags:"\u6682\u65E0\u6807\u7B7E",delete:"\u5220\u9664",deleting:"\u5220\u9664\u4E2D\u2026",deleteConfirm:"\u5220\u9664\u300C{title}\u300D\uFF1F",deleteConfirmBody:"\u6761\u76EE\u4F1A\u8FDB\u56DE\u6536\u7AD9\uFF0C\u4E4B\u540E\u8FD8\u80FD\u6062\u590D\u3002",deleteConfirmLinked:"\u8FD9\u662F\u7D22\u5F15\u6761\u76EE\uFF1A\u5220\u9664\u53EA\u79FB\u9664\u7D22\u5F15\uFF0C\u4E0D\u4F1A\u52A8\u539F\u6587\u4EF6\u3002",cancel:"\u53D6\u6D88",confirm:"\u786E\u5B9A",restore:"\u6062\u590D",purge:"\u5F7B\u5E95\u5220\u9664",purgeConfirm:"\u5F7B\u5E95\u5220\u9664\u300C{title}\u300D\uFF1F",purgeConfirmBody:"\u6587\u4EF6\u526F\u672C\u6216\u7B14\u8BB0\u6B63\u6587\u4F1A\u88AB\u5220\u6389\uFF0C\u65E0\u6CD5\u6062\u590D\u3002\u7D22\u5F15\u6761\u76EE\u53EA\u5220\u7D22\u5F15\uFF0C\u4E0D\u4F1A\u52A8\u539F\u6587\u4EF6\u3002",deleteDone:"\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9",restored:"\u5DF2\u6062\u590D",purgeDone:"\u5DF2\u5F7B\u5E95\u5220\u9664",trashHint:"\u56DE\u6536\u7AD9\u91CC\u7684\u6761\u76EE\u4E0D\u53EF\u7F16\u8F91\uFF0C\u53EF\u4EE5\u6062\u590D\u6216\u5F7B\u5E95\u5220\u9664\u3002",storageNote:"\u672C\u5E93\u7B14\u8BB0",storageLinked:"\u7D22\u5F15",storageBlob:"\u526F\u672C",linesTotal:"\u5171 {n} \u884C",linesShown:"\u663E\u793A\u524D {shown} \u884C",truncated:"\u5DF2\u622A\u65AD",binaryPreview:"\u8FD9\u4E2A\u6587\u4EF6\u662F\u4E8C\u8FDB\u5236\uFF0C\u6CA1\u6CD5\u5728\u8FD9\u91CC\u9884\u89C8\u3002",imagePreview:"\u56FE\u7247\u9884\u89C8",previewFailed:"\u9884\u89C8\u52A0\u8F7D\u5931\u8D25",pathLabel:"\u8DEF\u5F84",scanDone:"\u626B\u63CF\u5B8C\u6210",scanFailed:"\u626B\u63CF\u5931\u8D25",scanResult:"{name}\uFF1A\u65B0\u589E {added} \xB7 \u66F4\u65B0 {updated} \xB7 \u79FB\u9664 {removed} \xB7 \u8DF3\u8FC7 {skipped} \xB7 \u9519\u8BEF {errors}",scanNoSources:"\u6CA1\u6709\u53EF\u626B\u63CF\u7684\u6765\u6E90\uFF0C\u5148\u6DFB\u52A0\u4E00\u4E2A\u3002",scanErrorsMore:"\u8FD8\u6709 {n} \u6761\u9519\u8BEF",scanErrorLine:"{path}\uFF1A{message}",noteCreated:"\u7B14\u8BB0\u5DF2\u521B\u5EFA",noteTitlePlaceholder:"\u7B14\u8BB0\u6807\u9898",noteContentPlaceholder:"\u4ECE\u8FD9\u91CC\u5F00\u59CB\u5199\u2026",create:"\u521B\u5EFA",creating:"\u521B\u5EFA\u4E2D\u2026",errorPrefix:"\u51FA\u9519\u4E86",close:"\u5173\u95ED",untitled:"\u65E0\u6807\u9898",viewLabel:"\u5C55\u793A\u65B9\u5F0F",viewList:"\u5217\u8868",viewCards:"\u5361\u7247",viewTable:"\u8868\u683C",viewGallery:"\u56FE\u5E93",colTitle:"\u6807\u9898",colKind:"\u7C7B\u578B",colCollection:"\u5F52\u7C7B",colTags:"\u6807\u7B7E",colSize:"\u5927\u5C0F",colUpdated:"\u66F4\u65B0\u65F6\u95F4",galleryEmpty:"\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u56FE\u7247",galleryEmptyBody:"\u5F53\u524D\u7ED3\u679C\u91CC\u6CA1\u6709\u56FE\u7247\u6761\u76EE\uFF0C\u6362\u4E2A\u7B5B\u9009\u6761\u4EF6\u8BD5\u8BD5\u3002",mdRender:"\u6E32\u67D3",mdSource:"\u6E90\u7801",previewFullscreen:"\u5168\u5C4F\u9884\u89C8",previewFullscreenExit:"\u9000\u51FA\u5168\u5C4F",assistOpen:"\u52A9\u624B",assistTitle:"\u667A\u80FD\u52A9\u624B",assistTabSummary:"\u603B\u7ED3",assistTabOrganize:"\u6574\u7406",assistTabAsk:"\u63D0\u95EE",assistStatusLoading:"\u6B63\u5728\u68C0\u67E5\u52A9\u624B\u2026",assistModel:"\u6A21\u578B {model}",assistModelUnknown:"\u6A21\u578B\u672A\u6807\u6CE8",assistNotReady:"\u52A9\u624B\u672A\u5C31\u7EEA",assistUnavailable:"\u52A9\u624B\u670D\u52A1\u6682\u4E0D\u53EF\u7528\uFF08HTTP {status}\uFF09\uFF0C\u7A0D\u540E\u518D\u8BD5\u3002",assistNeedsRestart:"\u52A9\u624B\u63A5\u53E3\u5C1A\u672A\u52A0\u8F7D\uFF0C\u91CD\u542F GUI \u540E\u53EF\u7528",assistRetry:"\u91CD\u8BD5",assistNeedReady:"\u52A9\u624B\u8FD8\u6CA1\u5C31\u7EEA\uFF0C\u5148\u5904\u7406\u4E0A\u9762\u7684\u95EE\u9898\u3002",assistSummaryHint:"\u5148\u5728\u5217\u8868\u91CC\u9009\u4E2D\u4E00\u6761\uFF0C\u518D\u751F\u6210\u6458\u8981\u3002",assistSummarize:"\u603B\u7ED3\u8FD9\u6761",assistSummarizing:"\u603B\u7ED3\u4E2D\u2026",assistSummaryResult:"\u6458\u8981",assistNoActions:"\u6CA1\u6709\u53EF\u5E94\u7528\u7684\u6574\u7406\u5EFA\u8BAE\u3002",assistApply:"\u5E94\u7528",assistApplying:"\u5E94\u7528\u4E2D\u2026",assistApplied:"\u5DF2\u5E94\u7528\u300C{label}\u300D",assistAppliedShort:"\u5DF2\u5E94\u7528",assistApplyAll:"\u5168\u90E8\u5E94\u7528",assistAppliedCount:"\u5DF2\u5E94\u7528 {n} \u6761\u5EFA\u8BAE",assistOrganizeHint:"\u5BF9\u5F53\u524D\u7B5B\u9009\u7ED3\u679C\u7684\u524D 15 \u6761\u7ED9\u51FA\u5F52\u7C7B\u4E0E\u6807\u7B7E\u5EFA\u8BAE\u3002",assistOrganizeRun:"\u751F\u6210\u5EFA\u8BAE",assistOrganizeRunning:"\u751F\u6210\u4E2D\u2026",assistOrganizeEmpty:"\u5F53\u524D\u6CA1\u6709\u53EF\u6574\u7406\u7684\u6761\u76EE\uFF08\u53EA\u5904\u7406 active \u72B6\u6001\uFF09\u3002",assistOrganizeTargets:"\u5C06\u5BF9 {n} \u6761\u7ED9\u5EFA\u8BAE",assistSuggestedCollection:"\u5EFA\u8BAE\u5F52\u7C7B",assistSuggestedTags:"\u5EFA\u8BAE\u6807\u7B7E",assistReason:"\u539F\u56E0",assistNoTags:"\u65E0",assistApplyFilter:"\u5E94\u7528\u7B5B\u9009",assistFiltersApplied:"\u5DF2\u5E94\u7528\u7B5B\u9009",assistAskHint:"\u6BD4\u5982\uFF1A\u4E0A\u5468\u6539\u8FC7\u7684 Python \u811A\u672C / \u6709\u914D\u56FE\u7684\u6587\u6863\u3002",assistAskPlaceholder:"\u7528\u4E00\u53E5\u8BDD\u63CF\u8FF0\u4F60\u60F3\u627E\u4EC0\u4E48\u2026",assistAskRun:"\u95EE",assistAsking:"\u601D\u8003\u4E2D\u2026",assistAnswer:"\u56DE\u7B54",assistNoFilters:"\u8FD9\u6761\u56DE\u7B54\u6CA1\u6709\u7ED9\u51FA\u7B5B\u9009\u6761\u4EF6\u3002",assistResultMeta:"\u7531 {model} \u751F\u6210",assistFailed:"\u52A9\u624B\u8C03\u7528\u5931\u8D25"},Ni={panelTitle:"Library",appTitle:"Context Library",appSub:"Docs / scripts / images, one search",searchPlaceholder:"Search titles, tags, paths, text\u2026",kindAll:"All types",kindDoc:"Docs",kindScript:"Scripts",kindImage:"Images",kindData:"Data",kindSession:"Sessions",kindNote:"Notes",kindOther:"Other",sortLabel:"Sort",sortRelevance:"Relevance",sortUpdated:"Updated",sortTitle:"Title",sortSize:"Size",scan:"Scan",scanning:"Scanning\u2026",newNote:"New note",trashToggle:"Trash",refresh:"Refresh",backToChat:"Back to chat",sources:"Sources",collections:"Collections",tags:"Tags",allSources:"All sources",allCollections:"All collections",addSource:"Add source",sourceName:"Name",sourcePath:"Path (absolute or starting with ~)",add:"Add",removeSource:"Remove source",removeSourceConfirm:'Remove source "{name}"? Entries indexed from it are removed too (original files are untouched).',sourceAdded:'Source "{name}" added',sourceRemoved:"Source removed",sourceMissing:"Path not found",unknownSource:"No source",sourceCount:"{n} items",emptyTitle:"The library is empty",emptyBody:'Hit "Scan" above to pull files in, or write a note first.',emptyFiltered:"No matching entries",emptyFilteredBody:"Try another keyword, or clear the filters.",emptyTrash:"Trash is empty",emptyTrashBody:"Deleted entries land here before you restore or purge them.",clearFilters:"Clear filters",loading:"Loading\u2026",loadMore:"Load more",loadingMore:"Loading\u2026",totalCount:"{n} items",detailEmpty:"Select an entry",detailEmptyBody:"Title, tags, notes and a text preview show up here.",loadingDetail:"Reading this entry\u2026",fieldTitle:"Title",fieldCollection:"Collection",fieldTags:"Tags",fieldTagsHint:"comma separated",fieldNotes:"Notes",fieldNotesPlaceholder:"Notes for future you \u2014 search matches here too\u2026",fieldContent:"Content",save:"Save",saving:"Saving\u2026",saved:"Saved",copyPath:"Copy path",copyContent:"Copy content",copied:"Copied",copyFailed:"Copy failed \u2014 the browser denied clipboard access",revealInFinder:"Reveal in Finder",revealing:"Opening Finder\u2026",revealed:"Revealed in Finder",noPath:"No original path (note or copy)",noTags:"No tags",delete:"Delete",deleting:"Deleting\u2026",deleteConfirm:'Delete "{title}"?',deleteConfirmBody:"It goes to trash and can be restored later.",deleteConfirmLinked:"This is an index entry: deleting removes the index only, never the original file.",cancel:"Cancel",confirm:"Confirm",restore:"Restore",purge:"Purge",purgeConfirm:'Permanently delete "{title}"?',purgeConfirmBody:"Copied blobs or note content are deleted for good. Index entries only lose the index row.",deleteDone:"Moved to trash",restored:"Restored",purgeDone:"Permanently deleted",trashHint:"Trashed entries are read-only; restore or purge them.",storageNote:"Library note",storageLinked:"Index",storageBlob:"Copy",linesTotal:"{n} lines",linesShown:"showing first {shown}",truncated:"truncated",binaryPreview:"Binary file \u2014 no preview here.",imagePreview:"Image preview",previewFailed:"Preview failed to load",pathLabel:"Path",scanDone:"Scan finished",scanFailed:"Scan failed",scanResult:"{name}: added {added} \xB7 updated {updated} \xB7 removed {removed} \xB7 skipped {skipped} \xB7 errors {errors}",scanNoSources:"No sources to scan yet \u2014 add one first.",scanErrorsMore:"{n} more errors",scanErrorLine:"{path}: {message}",noteCreated:"Note created",noteTitlePlaceholder:"Note title",noteContentPlaceholder:"Start writing\u2026",create:"Create",creating:"Creating\u2026",errorPrefix:"Something went wrong",close:"Close",untitled:"Untitled",viewLabel:"View",viewList:"List",viewCards:"Cards",viewTable:"Table",viewGallery:"Gallery",colTitle:"Title",colKind:"Type",colCollection:"Collection",colTags:"Tags",colSize:"Size",colUpdated:"Updated",galleryEmpty:"No images to show",galleryEmptyBody:"No image entries match this filter \u2014 try another one.",mdRender:"Rendered",mdSource:"Source",previewFullscreen:"Fullscreen preview",previewFullscreenExit:"Exit fullscreen",assistOpen:"Assistant",assistTitle:"Assistant",assistTabSummary:"Summary",assistTabOrganize:"Organize",assistTabAsk:"Ask",assistStatusLoading:"Checking the assistant\u2026",assistModel:"Model {model}",assistModelUnknown:"Model not reported",assistNotReady:"Assistant not ready",assistUnavailable:"Assistant service is unavailable right now (HTTP {status}). Try again later.",assistNeedsRestart:"The assistant API is not loaded yet \u2014 restart the GUI to enable it.",assistRetry:"Retry",assistNeedReady:"The assistant is not ready yet \u2014 fix the issue above first.",assistSummaryHint:"Select an entry in the list first, then generate a summary.",assistSummarize:"Summarize this",assistSummarizing:"Summarizing\u2026",assistSummaryResult:"Summary",assistNoActions:"No applicable suggestions.",assistApply:"Apply",assistApplying:"Applying\u2026",assistApplied:'Applied "{label}"',assistAppliedShort:"Applied",assistApplyAll:"Apply all",assistAppliedCount:"Applied {n} suggestions",assistOrganizeHint:"Suggest collections and tags for the first 15 entries in the current filter.",assistOrganizeRun:"Suggest",assistOrganizeRunning:"Generating\u2026",assistOrganizeEmpty:"Nothing to organize here (only active entries are processed).",assistOrganizeTargets:"Suggestions for {n} entries",assistSuggestedCollection:"Collection",assistSuggestedTags:"Tags",assistReason:"Reason",assistNoTags:"None",assistApplyFilter:"Apply filter",assistFiltersApplied:"Filter applied",assistAskHint:"e.g. Python scripts edited last week / documents with images",assistAskPlaceholder:"Describe what you are looking for\u2026",assistAskRun:"Ask",assistAsking:"Thinking\u2026",assistAnswer:"Answer",assistNoFilters:"This answer did not include any filters.",assistResultMeta:"Generated by {model}",assistFailed:"Assistant request failed"};function I(e,t={}){return String(e??"").replace(/\{(\w+)\}/g,(a,n)=>Object.prototype.hasOwnProperty.call(t,n)?String(t[n]??""):a)}var Si=Oe(require("react"),1),me=Si.default.createElement,Gi=/^(?:https?:\/\/|\/(?!\/)|\.{0,2}\/|#)/i,_i=/(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;function qi(e){let t=String(e??"").trim();return Gi.test(t)?t:""}function Ze(e,t){let a=[],n=new RegExp(_i.source,"g"),l=0,b;for(;b=n.exec(e);){b.index>l&&a.push(e.slice(l,b.index));let m=`${t}-${a.length}`;if(b[1])a.push(me("code",{key:m},b[1].slice(1,-1)));else if(b[2])a.push(me("strong",{key:m},b[2].slice(2,-2)));else{let p=qi(b[5]);a.push(p?me("a",{key:m,href:p,target:"_blank",rel:"noreferrer noopener"},b[4]):b[0])}l=b.index+b[0].length}return l<e.length&&a.push(e.slice(l)),a}var ei=/^\s*[-*+]\s+(.*)$/,He=/^\s*\d+[.)]\s+(.*)$/,Ci=/^(#{1,6})\s+(.*)$/,Wi=/^\s*```\s*([\w+-]*)\s*$/;function Yi(e){return/^\s*$/.test(e)||/^\s*```/.test(e)||Ci.test(e)||ei.test(e)||He.test(e)}function Re({text:e,className:t}){let a=String(e??"").replace(/\r\n?/g,`
`).split(`
`),n=[],l=0;for(;l<a.length;){let b=a[l];if(/^\s*$/.test(b)){l+=1;continue}let m=Wi.exec(b);if(m){let y=[];for(l+=1;l<a.length&&!/^\s*```\s*$/.test(a[l]);)y.push(a[l]),l+=1;l+=1,n.push(me("pre",{key:`f-${n.length}`},me("code",m[1]?{"data-lang":m[1]}:null,y.join(`
`))));continue}let p=Ci.exec(b);if(p){let y=p[1].length;n.push(me(`h${y}`,{key:`h-${n.length}`},Ze(p[2],`h${n.length}`))),l+=1;continue}if(ei.exec(b)||He.exec(b)){let y=He.test(b),j=y?"ol":"ul",P=y?He:ei,c=[];for(;l<a.length;){let $=P.exec(a[l]);if(!$)break;c.push(me("li",{key:`li-${l}`},Ze($[1],`li-${l}`))),l+=1}n.push(me(j,{key:`l-${n.length}`},c));continue}let f=[];for(;l<a.length&&!Yi(a[l]);)f.push(a[l].trim()),l+=1;if(!f.length){l+=1;continue}n.push(me("p",{key:`p-${n.length}`},Ze(f.join(" "),`p${n.length}`)))}return me("div",{className:`clib-md${t?` ${t}`:""}`},n)}var E=Oe(require("react"),1);var s=E.default.createElement,Qi=[["summary","assistTabSummary"],["organize","assistTabOrganize"],["ask","assistTabAsk"]],Xi=15;function $e(e,t){let a=t?.status,n=t?.message||String(t||"");return t?.code==="not-found"&&/Unknown route/i.test(n)?e("assistNeedsRestart"):a===503||a===502?I(e("assistUnavailable"),{status:a}):n}function Ue({Icon:e}){return s("span",{className:"clib-spin clib-spin-inline"},s(e,{name:"refresh",size:12}))}function Ji(e,t){return t?t.ready?t.model?I(e("assistModel"),{model:t.model}):e("assistModelUnknown"):t.reason||e("assistNotReady"):e("assistStatusLoading")}function zi({t:e,Icon:t,open:a,onClose:n,item:l,items:b,onApplyFilters:m,onChanged:p,pushToast:S,toastError:f}){let[y,j]=E.default.useState("summary"),[P,c]=E.default.useState(null),[$,L]=E.default.useState(null),[Y,R]=E.default.useState(!1),u=E.default.useCallback(async()=>{R(!0),L(null);try{c(await yi())}catch(r){c(null),L(r)}finally{R(!1)}},[]);E.default.useEffect(()=>{a&&u()},[a,u]);let h=!!P?.ready;function k(r){let g=$e(e,r);g===(r?.message??String(r??""))?f(r):f(new Error(g))}let[T,ke]=E.default.useState(null),[z,G]=E.default.useState(!1),[Q,_]=E.default.useState({});E.default.useEffect(()=>{ke(null),_({})},[l?.id]);async function Ne(){if(!(!l||z||!h)){G(!0);try{ke(await je({mode:"summary",id:l.id}))}catch(r){k(r)}finally{G(!1)}}}async function ge(r){if(!l||Q[r.key]?.state==="busy"||Q[r.key]?.state==="done")return;_(x=>({...x,[r.key]:{state:"busy"}}));let g=r.key==="tags"?{tags:r.value}:{[r.key]:r.value};try{await Ee(l.id,g),_(x=>({...x,[r.key]:{state:"done"}})),S({type:"ok",title:I(e("assistApplied"),{label:r.label})}),p()}catch(x){_(K=>({...K,[r.key]:{state:"error",error:$e(e,x)}})),k(x)}}let[V,te]=E.default.useState(null),[oe,ae]=E.default.useState(!1),[F,H]=E.default.useState(!1),[X,O]=E.default.useState({}),ce=E.default.useMemo(()=>(b??[]).filter(r=>(r.status??"active")==="active").slice(0,Xi),[b]),le=E.default.useMemo(()=>{let r={};for(let g of b??[])r[g.id]=g.title||g.path||g.id;return r},[b]);async function fe(){if(oe||!h)return;let r=ce.map(g=>g.id);if(!r.length){te({mode:"organize",model:P?.model??null,text:"",actions:{items:[]}});return}ae(!0);try{let g=await je({mode:"organize",ids:r});te(g),O({})}catch(g){k(g)}finally{ae(!1)}}async function D(r){if(!r?.id||X[r.id]?.state==="busy"||X[r.id]?.state==="done")return!1;O(x=>({...x,[r.id]:{state:"busy"}}));let g={};if(typeof r.collection=="string"&&r.collection&&(g.collection=r.collection),Array.isArray(r.tags)&&(g.tags=r.tags),!Object.keys(g).length)return O(x=>({...x,[r.id]:{state:"error",error:e("assistNoActions")}})),!1;try{return await Ee(r.id,g),O(x=>({...x,[r.id]:{state:"done"}})),!0}catch(x){return O(K=>({...K,[r.id]:{state:"error",error:$e(e,x)}})),!1}}async function Se(r){if(F)return;await D(r)&&p()}async function he(){if(F||!V?.actions?.items?.length)return;H(!0);let r=0;try{for(let g of V.actions.items){if(X[g.id]?.state==="done")continue;await D(g)&&(r+=1)}}finally{H(!1)}r&&(p(),S({type:"ok",title:I(e("assistAppliedCount"),{n:r})}))}let[J,de]=E.default.useState(""),[ee,Me]=E.default.useState(null),[xe,ve]=E.default.useState(!1);async function ze(){let r=J.trim();if(!(!r||xe||!h)){ve(!0);try{Me(await je({mode:"ask",question:r}))}catch(g){k(g)}finally{ve(!1)}}}let ye=ee?.actions?.filters??null,ie=ye?Object.entries(ye).filter(([,r])=>r!=null&&String(r).trim()!==""):[];function be(){ie.length&&(m(ye),S({type:"ok",title:e("assistFiltersApplied")}))}if(!a)return null;let Z=Y?e("assistStatusLoading"):$?$e(e,$):Ji(e,P),q=$?s("button",{type:"button",className:"clib-btn",onClick:u,disabled:Y},e("assistRetry")):null,we=$||P&&!P.ready?s("div",{className:"clib-assist-warn"},s("span",null,$?$e(e,$):e("assistNeedReady")),q):null,se=s("div",{className:"clib-assist-tabs",role:"tablist"},Qi.map(([r,g])=>s("button",{key:r,type:"button",role:"tab","aria-selected":y===r,className:`clib-assist-tab${y===r?" is-on":""}`,onClick:()=>j(r)},e(g)))),ne;if(y==="summary"){let r=[];T?.actions&&typeof T.actions=="object"&&(typeof T.actions.title=="string"&&T.actions.title&&r.push({key:"title",label:e("fieldTitle"),value:T.actions.title}),typeof T.actions.collection=="string"&&T.actions.collection&&r.push({key:"collection",label:e("fieldCollection"),value:T.actions.collection}),Array.isArray(T.actions.tags)&&T.actions.tags.length&&r.push({key:"tags",label:e("fieldTags"),value:T.actions.tags,text:T.actions.tags.join(", ")})),ne=s("div",{className:"clib-assist-pane"},l?s("div",{className:"clib-assist-card"},s("div",{className:"clib-assist-card-head"},s(t,{name:"note",size:12}),s("b",null,l.title||e("untitled")),s("span",{className:"clib-assist-meta"},e(Zi(l.kind)))),s("div",{className:"clib-assist-actions"},s("span",{className:"clib-grow"}),s("button",{type:"button",className:"clib-btn is-primary",disabled:z||!h,onClick:Ne},z?s(Ue,{Icon:t}):s(t,{name:"sparkle",size:12}),e(z?"assistSummarizing":"assistSummarize")))):s("div",{className:"clib-assist-empty"},e("assistSummaryHint")),T?.text?s("div",{className:"clib-assist-card"},s("div",{className:"clib-assist-card-head"},s("b",null,e("assistSummaryResult"))),s(Re,{text:T.text,className:"is-plain"}),T.model?s("div",{className:"clib-assist-meta"},I(e("assistResultMeta"),{model:T.model})):null):null,T&&!r.length?s("div",{className:"clib-assist-empty"},e("assistNoActions")):null,r.length?s("div",{className:"clib-assist-card"},r.map(g=>{let x=Q[g.key];return s("div",{key:g.key,className:"clib-assist-change"},s("div",{className:"clib-assist-change-main"},s("span",{className:"clib-assist-change-label"},g.label),s("span",{className:"clib-assist-change-value"},g.text??g.value),x?.state==="error"?s("span",{className:"clib-assist-error"},x.error):null),x?.state==="done"?s("span",{className:"clib-assist-done"},s(t,{name:"check",size:12}),e("assistAppliedShort")):s("button",{type:"button",className:"clib-btn",disabled:x?.state==="busy"||!l,onClick:()=>ge(g)},x?.state==="busy"?e("assistApplying"):e("assistApply")))})):null)}else if(y==="organize"){let r=V?.actions?.items??[],g=r.filter(x=>X[x.id]?.state==="done").length;ne=s("div",{className:"clib-assist-pane"},s("div",{className:"clib-assist-hint"},e("assistOrganizeHint")),s("div",{className:"clib-assist-actions"},s("button",{type:"button",className:"clib-btn is-primary",disabled:oe||!h||!ce.length,onClick:fe},oe?s(Ue,{Icon:t}):s(t,{name:"sparkle",size:12}),e(oe?"assistOrganizeRunning":"assistOrganizeRun")),s("span",{className:"clib-assist-meta"},I(e("assistOrganizeTargets"),{n:ce.length}))),V&&!r.length?s("div",{className:"clib-assist-empty"},e("assistOrganizeEmpty")):null,r.length?s(E.default.Fragment,null,s("div",{className:"clib-assist-actions"},s("span",{className:"clib-grow"}),s("button",{type:"button",className:"clib-btn",disabled:F||g>=r.length,onClick:he},F?s(Ue,{Icon:t}):s(t,{name:"check",size:12}),e("assistApplyAll"))),s("table",{className:"clib-assist-table"},s("colgroup",null,s("col",null),s("col",{style:{width:"58px"}}),s("col",{style:{width:"74px"}}),s("col",null),s("col",{style:{width:"46px"}})),s("thead",null,s("tr",null,s("th",null,e("colTitle")),s("th",null,e("assistSuggestedCollection")),s("th",null,e("assistSuggestedTags")),s("th",null,e("assistReason")),s("th",null,""))),s("tbody",null,r.map(x=>{let K=X[x.id];return s(E.default.Fragment,{key:x.id},s("tr",{className:K?.state==="done"?"is-done":void 0},s("td",{className:"clib-assist-td-title"},le[x.id]||x.id),s("td",null,x.collection||"\u2014"),s("td",null,s("span",{className:"clib-assist-tags"},(x.tags??[]).length?x.tags.map(pe=>s("span",{key:pe,className:"clib-mini-tag"},`#${pe}`)):e("assistNoTags"))),s("td",{className:"clib-assist-td-reason"},x.reason||""),s("td",{className:"clib-assist-td-action"},K?.state==="done"?s("span",{className:"clib-assist-done"},s(t,{name:"check",size:11})):K?.state==="error"?s("span",{className:"clib-assist-error"},e("assistFailed")):s("button",{type:"button",className:"clib-btn",disabled:F||K?.state==="busy",onClick:()=>Se(x)},K?.state==="busy"?"\u2026":e("assistApply")))),K?.state==="error"?s("tr",null,s("td",{className:"clib-assist-error-row",colSpan:5},K.error||e("assistFailed"))):null)})))):null)}else ne=s("div",{className:"clib-assist-pane"},s("div",{className:"clib-assist-hint"},e("assistAskHint")),s("div",{className:"clib-assist-ask"},s("input",{className:"clib-input",value:J,placeholder:e("assistAskPlaceholder"),"aria-label":e("assistAskPlaceholder"),onChange:r=>de(r.target.value),onKeyDown:r=>{r.key==="Enter"&&ze()}}),s("button",{type:"button",className:"clib-btn is-primary",disabled:xe||!h||!J.trim(),onClick:ze},xe?s(Ue,{Icon:t}):null,e(xe?"assistAsking":"assistAskRun"))),ee?.text?s("div",{className:"clib-assist-card"},s("div",{className:"clib-assist-card-head"},s("b",null,e("assistAnswer"))),s(Re,{text:ee.text,className:"is-plain"}),ee.model?s("div",{className:"clib-assist-meta"},I(e("assistResultMeta"),{model:ee.model})):null):null,ee&&!ie.length?s("div",{className:"clib-assist-empty"},e("assistNoFilters")):null,ie.length?s("div",{className:"clib-assist-card"},s("div",{className:"clib-assist-tags"},ie.map(([r,g])=>s("span",{key:r,className:"clib-mini-tag"},`${r}: ${g}`))),s("div",{className:"clib-assist-actions"},s("button",{type:"button",className:"clib-btn is-primary",onClick:be},s(t,{name:"search",size:12}),e("assistApplyFilter")))):null);return s("aside",{className:"clib-assist",role:"complementary","aria-label":e("assistTitle")},s("div",{className:"clib-assist-head"},s(t,{name:"sparkle",size:15}),s("div",{className:"clib-assist-titles"},s("b",null,e("assistTitle")),s("small",null,Z)),s("button",{type:"button",className:"clib-btn clib-icon",onClick:n,title:e("close"),"aria-label":e("close")},s(t,{name:"close",size:12}))),se,s("div",{className:"clib-assist-body"},we,ne))}function Zi(e){return{doc:"kindDoc",script:"kindScript",image:"kindImage",data:"kindData",session:"kindSession",note:"kindNote",other:"kindOther"}[e]??"kindOther"}var i=o.default.createElement,Ti=50,Ke=["list","cards","table","gallery"],et={list:"viewList",cards:"viewCards",table:"viewTable",gallery:"viewGallery"};function Ai(e,t){try{return typeof window>"u"||!window.localStorage?t:window.localStorage.getItem(e)??t}catch{return t}}function Mi(e,t){try{typeof window<"u"&&window.localStorage&&window.localStorage.setItem(e,t)}catch{}}var ii=2e4,Ei=400,Ri=/^(doc|docx|rtf|rtfd|odt|pdf|xls|xlsx|ppt|pptx|key|pages|numbers|epub|html|htm|xhtml)$/i,it={fill:"none",stroke:"currentColor",strokeWidth:1.4,strokeLinecap:"round",strokeLinejoin:"round"},w=(e,t)=>i(e,t),$i={search:[w("circle",{cx:7,cy:7,r:4.3}),w("path",{d:"M10.2 10.2 13.4 13.4"})],plus:[w("path",{d:"M8 3v10M3 8h10"})],refresh:[w("path",{d:"M13 8a5 5 0 1 1-1.5-3.6"}),w("path",{d:"M13 2.8V5.4h-2.6"})],scan:[w("path",{d:"M2.4 8a5.6 5.6 0 0 1 5.6-5.6M13.6 8A5.6 5.6 0 0 1 8 13.6"}),w("circle",{cx:8,cy:8,r:1.5}),w("path",{d:"M8 2.4v2M8 11.6v2M2.4 8h2M11.6 8h2"})],trash:[w("path",{d:"M2.8 4.2h10.4M5.8 4.2V2.8h4.4v1.4M4.2 4.2l.7 9h6.2l.7-9M6.7 6.8v4M9.3 6.8v4"})],close:[w("path",{d:"M4 4l8 8M12 4l-8 8"})],chevron:[w("path",{d:"M6 3.6 10.4 8 6 12.4"})],expand:[w("path",{d:"M2.4 6V2.4H6M10 2.4h3.6V6M13.6 10v3.6H10M6 13.6H2.4V10"})],collapse:[w("path",{d:"M6 2.4V6H2.4M10 2.4V6h3.6M13.6 10H10v3.6M6 13.6V10H2.4"})],back:[w("path",{d:"M13 8H3M7 4 3 8l4 4"})],book:[w("path",{d:"M2 3.2h3.7c1.2 0 2.3.7 2.3 1.8v8c-.4-1.1-1.5-1.8-2.7-1.8H2zM8 5c0-1.1 1.1-1.8 2.3-1.8H14v8h-3.7c-1.2 0-2.3.7-2.3 1.8"})],doc:[w("path",{d:"M4 1.8h4.7l3.5 3.5v8.9H4zM8.6 1.8v3.7h3.6"})],script:[w("rect",{x:2.2,y:2.4,width:11.6,height:11.2,rx:1.6}),w("path",{d:"M6.2 6 4.3 8l1.9 2M9.8 6 11.7 8l-1.9 2"})],image:[w("rect",{x:2,y:3,width:12,height:10,rx:1.5}),w("circle",{cx:6,cy:6.5,r:1}),w("path",{d:"M2.8 12 6 9l2.2 2 2.6-2.6 2.6 4.1"})],data:[w("ellipse",{cx:8,cy:4,rx:5,ry:2}),w("path",{d:"M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"})],session:[w("path",{d:"M2.4 3.4h11.2v7.2H7.2L4 13.4v-2.8H2.4zM5 6.2h6M5 8.2h4"})],note:[w("path",{d:"M3 1.8h10v9.4L10.2 14H3zM10.2 14v-2.8H13M5.4 5.2h5M5.4 7.4h3.4"})],other:[w("path",{d:"M4 1.8h4.7l3.5 3.5v8.9H4zM8.6 1.8v3.7h3.6M6 9h4"})],folder:[w("path",{d:"M2 4.2h4l1.4 1.6H14v7.6H2z"})],tag:[w("path",{d:"M2.4 2.4h5.1l6.1 6.1-5.1 5.1-6.1-6.1z"}),w("circle",{cx:5.6,cy:5.6,r:1})],copy:[w("rect",{x:5.2,y:5.2,width:8,height:8,rx:1.4}),w("path",{d:"M10.8 5.2V4a1.4 1.4 0 0 0-1.4-1.4H4A1.4 1.4 0 0 0 2.6 4v5.4A1.4 1.4 0 0 0 4 10.8h1.2"})],save:[w("path",{d:"M2.8 2.8h8.8l1.6 1.6v8.8H2.8zM5 2.8v3.4h5V2.8M5 13.2V9.4h6v3.8"})],restore:[w("path",{d:"M3 5.6A5.4 5.4 0 1 1 2.8 9M2.6 2.6v3.2h3.2"})],check:[w("path",{d:"M3 8.4 6.4 12 13 4.6"})],sparkle:[w("path",{d:"M7 1.8 8.5 6.2 12.9 7.7 8.5 9.2 7 13.6 5.5 9.2 1.1 7.7 5.5 6.2z"}),w("path",{d:"M12.6 10.6l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"})]};function N({name:e,size:t=14}){let a=$i[e]??$i.other;return i("svg",{width:t,height:t,viewBox:"0 0 16 16",...it,"aria-hidden":!0},a.map((n,l)=>o.default.cloneElement(n,{key:l})))}var tt=["doc","script","image","data","session","note"],at=["relevance","updated","title","size"],Pe={doc:"kindDoc",script:"kindScript",image:"kindImage",data:"kindData",session:"kindSession",note:"kindNote",other:"kindOther"};function _e(e){return Pe[e]?e:"other"}function Ge(e){let t=Number(e);if(!Number.isFinite(t)||t<=0)return"0 B";let a=["B","KB","MB","GB"],n=t,l=0;for(;n>=1024&&l<a.length-1;)n/=1024,l+=1;return`${l===0||n>=10?Math.round(n):n.toFixed(1)} ${a[l]}`}function qe(e){if(!e)return"";let t=new Date(e);if(Number.isNaN(t.getTime()))return"";let a=n=>String(n).padStart(2,"0");return`${t.getFullYear()}-${a(t.getMonth()+1)}-${a(t.getDate())} ${a(t.getHours())}:${a(t.getMinutes())}`}function lt(e){let t=new Set,a=[];for(let n of String(e??"").split(/[,，\n]/)){let l=n.trim();if(!(!l||t.has(l))&&(t.add(l),a.push(l),a.length>=24))break}return a}async function st(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}try{let t=document.createElement("textarea");t.value=e,t.setAttribute("readonly",""),t.style.position="fixed",t.style.top="-1000px",t.style.opacity="0",document.body.appendChild(t),t.select();let a=document.execCommand("copy");return t.remove(),a}catch{return!1}}function nt({t:e,onExit:t,qInput:a,onQuery:n,kind:l,onKind:b,sort:m,onSort:p,status:S,trashCount:f,onToggleTrash:y,onScan:j,scanning:P,onNewNote:c,onRefresh:$,refreshing:L,view:Y,onView:R,assistOpen:u,onToggleAssist:h}){return i("div",{className:"clib-toolbar"},i("button",{type:"button",className:"clib-btn clib-icon",onClick:t,title:e("backToChat"),"aria-label":e("backToChat")},i(N,{name:"back",size:14})),i("div",{className:"clib-brand"},i("b",null,e("appTitle")),i("small",null,e("appSub"))),i("label",{className:"clib-search"},i(N,{name:"search",size:13}),i("input",{type:"search",value:a,placeholder:e("searchPlaceholder"),"aria-label":e("searchPlaceholder"),onChange:k=>n(k.target.value)})),i("select",{className:"clib-select",value:l,"aria-label":e("kindAll"),disabled:S==="trashed",onChange:k=>b(k.target.value)},i("option",{value:""},e("kindAll")),...tt.map(k=>i("option",{key:k,value:k},e(Pe[k])))),i("select",{className:"clib-select",value:m,"aria-label":e("sortLabel"),disabled:S==="trashed",onChange:k=>p(k.target.value)},...at.map(k=>i("option",{key:k,value:k},e(`sort${k[0].toUpperCase()}${k.slice(1)}`)))),i("button",{type:"button",className:"clib-btn",onClick:j,disabled:P,title:e("scan")},i(N,{name:"scan",size:13}),e(P?"scanning":"scan")),i("button",{type:"button",className:"clib-btn is-primary",onClick:c},i(N,{name:"plus",size:13}),e("newNote")),i("button",{type:"button",className:`clib-btn${S==="trashed"?" is-on":""}`,onClick:y,title:e("trashToggle")},i(N,{name:"trash",size:13}),e("trashToggle"),f>0?` ${f}`:""),i("select",{className:"clib-select",value:Y,title:e("viewLabel"),"aria-label":e("viewLabel"),onChange:k=>R(k.target.value)},Ke.map(k=>i("option",{key:k,value:k},e(et[k])))),i("button",{type:"button",className:`clib-btn${u?" is-on":""}`,onClick:h,title:e("assistOpen"),"aria-pressed":!!u},i(N,{name:"sparkle",size:13}),e("assistOpen")),i("button",{type:"button",className:"clib-btn clib-icon",onClick:$,disabled:L,title:e("refresh"),"aria-label":e("refresh")},i("span",{className:L?"clib-spin":void 0},i(N,{name:"refresh",size:14}))))}function rt({t:e,sources:t,collections:a,tags:n,filters:l,disabled:b,onFilter:m,onAddSource:p,onRemoveSource:S}){let[f,y]=o.default.useState(!1),[j,P]=o.default.useState(""),[c,$]=o.default.useState(""),[L,Y]=o.default.useState(!1);async function R(u){if(u.preventDefault(),!j.trim()||!c.trim()||L)return;Y(!0);let h=await p({name:j.trim(),path:c.trim()});Y(!1),h&&(P(""),$(""),y(!1))}return i("aside",{className:"clib-side"},i("div",{className:"clib-side-title"},i("span",null,e("sources")),i("button",{type:"button",className:"clib-side-add",onClick:()=>y(u=>!u)},f?e("cancel"):`+ ${e("addSource")}`)),i("button",{type:"button",className:`clib-nav${l.source?"":" is-on"}`,disabled:b,onClick:()=>m({source:""})},i("span",{className:"clib-dot"}),i("span",{className:"clib-nav-label"},e("allSources"))),t.map(u=>i("div",{key:u.id,className:"clib-source-row"},i("button",{type:"button",className:`clib-nav${l.source===u.id?" is-on":""}`,disabled:b,title:u.path,onClick:()=>m({source:l.source===u.id?"":u.id})},i("span",{className:"clib-dot"}),i("span",{className:"clib-nav-label"},u.name,u.missing?i("span",{className:"clib-missing"},` \xB7 ${e("sourceMissing")}`):null),i("span",{className:"clib-count"},Number.isFinite(u.count)?u.count:"")),i("button",{type:"button",className:"clib-source-remove",title:e("removeSource"),"aria-label":e("removeSource"),onClick:()=>S(u)},i(N,{name:"close",size:11})))),f?i("form",{className:"clib-source-form",onSubmit:R},i("input",{className:"clib-input",value:j,placeholder:e("sourceName"),"aria-label":e("sourceName"),onChange:u=>P(u.target.value)}),i("input",{className:"clib-input",value:c,placeholder:e("sourcePath"),"aria-label":e("sourcePath"),onChange:u=>$(u.target.value)}),i("div",{className:"clib-source-form-row"},i("button",{type:"button",className:"clib-btn",onClick:()=>y(!1)},e("cancel")),i("button",{type:"submit",className:"clib-btn is-primary",disabled:L||!j.trim()||!c.trim()},e(L?"loading":"add")))):null,i("div",{className:"clib-side-title"},i("span",null,e("collections"))),i("button",{type:"button",className:`clib-nav${l.collection?"":" is-on"}`,disabled:b,onClick:()=>m({collection:""})},i(N,{name:"folder",size:12}),i("span",{className:"clib-nav-label"},e("allCollections"))),a.length?a.map(u=>i("button",{key:u.name,type:"button",className:`clib-nav${l.collection===u.name?" is-on":""}`,disabled:b,onClick:()=>m({collection:l.collection===u.name?"":u.name})},i(N,{name:"folder",size:12}),i("span",{className:"clib-nav-label"},u.name),i("span",{className:"clib-count"},u.count))):i("div",{className:"clib-side-empty"},"\u2014"),i("div",{className:"clib-side-title"},i("span",null,e("tags"))),n.length?i("div",{className:"clib-tagcloud"},n.map(u=>i("button",{key:u.name,type:"button",className:`clib-tag${l.tag===u.name?" is-on":""}`,disabled:b,title:l.tag===u.name?`${e("tags")} \xB7 ${u.name}`:u.name,onClick:()=>m({tag:l.tag===u.name?"":u.name})},i("span",null,`#${u.name}`),i("em",null,u.count)))):i("div",{className:"clib-side-empty"},e("noTags")))}function ot({t:e,item:t,active:a,sourceName:n,onClick:l}){let b=t.path||n||t.collection||"";return i("button",{type:"button",className:`clib-row${a?" is-on":""}`,onClick:l},i("span",{className:"clib-row-icon"},i(N,{name:_e(t.kind),size:15})),i("span",{className:"clib-row-body"},i("span",{className:"clib-row-title"},i("strong",null,t.title||e("untitled")),i("span",{className:"clib-badge"},e(Pe[t.kind]??"kindOther")),t.storage==="linked"?i("span",{className:"clib-badge"},e("storageLinked")):null),i("span",{className:"clib-row-meta"},b?i("span",{className:"clib-path"},b):null,i("span",{className:"clib-sep"},"\xB7"),i("span",{className:"clib-num"},Ge(t.size)),i("span",{className:"clib-sep"},"\xB7"),i("span",{className:"clib-num"},qe(t.updatedAt))),t.snippet?i("span",{className:"clib-row-snippet"},t.snippet):null,t.tags?.length?i("span",{className:"clib-row-tags"},t.tags.slice(0,4).map(m=>i("span",{key:m,className:"clib-mini-tag"},`#${m}`))):null))}function Pi(e,t){return e(Pe[t]??"kindOther")}function ct({t:e,items:t,selectedId:a,onSelect:n}){return i("div",{className:"clib-cards"},t.map(l=>i("button",{key:l.id,type:"button",className:`clib-card${l.id===a?" is-on":""}`,onClick:()=>n(l.id)},i("div",{className:"clib-card-thumb"},l.kind==="image"?i("img",{src:Be(l.id),alt:l.title||"",loading:"lazy"}):i("span",{className:"clib-card-glyph"},i(N,{name:_e(l.kind),size:24}))),i("span",{className:"clib-card-body"},i("strong",{className:"clib-card-title"},l.title||e("untitled")),i("span",{className:"clib-card-meta"},i("span",{className:"clib-badge"},Pi(e,l.kind)),l.collection?i("span",{className:"clib-badge"},l.collection):null),l.snippet?i("span",{className:"clib-card-snippet"},l.snippet):null,l.tags?.length?i("span",{className:"clib-card-tags"},l.tags.slice(0,3).map(b=>i("span",{key:b,className:"clib-mini-tag"},`#${b}`))):null,i("span",{className:"clib-card-meta"},i("span",{className:"clib-num"},qe(l.updatedAt)))))))}function dt({t:e,items:t,selectedId:a,onSelect:n,sort:l,onSort:b}){let m=[{key:"title",label:e("colTitle"),sort:"title"},{key:"kind",label:e("colKind")},{key:"collection",label:e("colCollection")},{key:"tags",label:e("colTags")},{key:"size",label:e("colSize"),sort:"size"},{key:"updated",label:e("colUpdated"),sort:"updated"}];return i("div",{className:"clib-table-wrap"},i("table",{className:"clib-table"},i("thead",null,i("tr",null,m.map(p=>i("th",{key:p.key,className:p.sort?"clib-th-sort":void 0,"aria-sort":p.sort&&l===p.sort?"ascending":void 0},p.sort?i("button",{type:"button",className:`clib-th-btn${l===p.sort?" is-on":""}`,onClick:()=>b(p.sort)},p.label,l===p.sort?i("span",{className:"clib-sort-mark"},"\u2191"):null):p.label)))),i("tbody",null,t.map(p=>i("tr",{key:p.id,className:p.id===a?"is-on":void 0,tabIndex:0,onClick:()=>n(p.id),onKeyDown:S=>{(S.key==="Enter"||S.key===" ")&&(S.preventDefault(),n(p.id))}},i("td",null,i("span",{className:"clib-td-title"},i(N,{name:_e(p.kind),size:12}),p.title||e("untitled"))),i("td",null,i("span",{className:"clib-badge"},Pi(e,p.kind))),i("td",null,p.collection||"\u2014"),i("td",null,i("span",{className:"clib-table-tags"},p.tags?.length?p.tags.slice(0,3).map(S=>i("span",{key:S,className:"clib-mini-tag"},`#${S}`)):"\u2014")),i("td",{className:"clib-num"},Ge(p.size)),i("td",{className:"clib-num"},qe(p.updatedAt)))))))}function bt({t:e,items:t,selectedId:a,onSelect:n}){let l=t.filter(b=>b.kind==="image");return l.length?i("div",{className:"clib-gallery"},l.map(b=>i("button",{key:b.id,type:"button",className:`clib-gal${b.id===a?" is-on":""}`,title:b.title||e("untitled"),onClick:()=>n(b.id)},i("img",{src:Be(b.id),alt:b.title||"",loading:"lazy"}),i("span",{className:"clib-gal-cap"},b.title||e("untitled"))))):i(Ve,{icon:"image",title:e("galleryEmpty"),body:e("galleryEmptyBody")})}function pt(){return i(o.default.Fragment,null,Array.from({length:6},(e,t)=>i("div",{key:t,className:"clib-skel"},i("div",{className:"clib-skel-avatar clib-shimmer"}),i("div",{className:"clib-skel-lines"},i("div",{className:"clib-skel-line clib-shimmer",style:{width:`${58+t%3*11}%`}}),i("div",{className:"clib-skel-line clib-shimmer",style:{width:`${34+t%4*9}%`}}),i("div",{className:"clib-skel-line clib-shimmer",style:{width:"88%"}})))))}function Ve({icon:e,title:t,body:a,action:n}){return i("div",{className:"clib-empty"},i("div",{className:"clib-empty-icon"},i(N,{name:e,size:22})),i("b",null,t),i("p",null,a),n||null)}function ut(e){let{t,items:a,total:n,loading:l,moreLoading:b,selectedId:m,onSelect:p,onLoadMore:S,status:f,hasFilters:y,onClearFilters:j,sourceNames:P,onNewNote:c,view:$,sort:L,onSort:Y}=e,R=Ke.includes($)?$:"list",u;return l&&!a.length?u=i(pt):a.length?R==="cards"?u=i(ct,{t,items:a,selectedId:m,onSelect:p}):R==="table"?u=i(dt,{t,items:a,selectedId:m,onSelect:p,sort:L,onSort:Y}):R==="gallery"?u=i(bt,{t,items:a,selectedId:m,onSelect:p}):u=a.map(h=>i(ot,{key:h.id,t,item:h,active:h.id===m,sourceName:P[h.sourceId]??"",onClick:()=>p(h.id)})):f==="trashed"?u=i(Ve,{icon:"trash",title:t("emptyTrash"),body:t("emptyTrashBody")}):y?u=i(Ve,{icon:"search",title:t("emptyFiltered"),body:t("emptyFilteredBody"),action:i("button",{type:"button",className:"clib-btn",onClick:j},t("clearFilters"))}):u=i(Ve,{icon:"book",title:t("emptyTitle"),body:t("emptyBody"),action:i("button",{type:"button",className:"clib-btn is-primary",onClick:c},i(N,{name:"plus",size:13}),t("newNote"))}),i("main",{className:"clib-main"},i("div",{className:"clib-list-head"},i("span",null,l?t("loading"):I(t("totalCount"),{n})),i("b",null,f==="trashed"?t("trashToggle"):"")),i("div",{className:`clib-list clib-list-${R}`},u),a.length<n?i("div",{className:"clib-list-foot"},i("button",{type:"button",className:"clib-btn",disabled:b,onClick:S},t(b?"loadingMore":"loadMore"))):null)}function mt(e,t){return{title:e.title??"",collection:e.collection??"inbox",tags:(e.tags??[]).join(", "),notes:e.notes??"",content:e.storage==="note"?t?.text??"":""}}function gt({t:e,id:t,collections:a,sourceNames:n,onClose:l,onChanged:b,pushToast:m,toastError:p,version:S=0}){let[f,y]=o.default.useState(!1),[j,P]=o.default.useState(0),[c,$]=o.default.useState(null),[L,Y]=o.default.useState(null),[R,u]=o.default.useState(null),[h,k]=o.default.useState(null),[T,ke]=o.default.useState(""),[z,G]=o.default.useState(""),[Q,_]=o.default.useState(""),[Ne,ge]=o.default.useState(!1),[V,te]=o.default.useState(null),[oe,ae]=o.default.useState(!1),[F,H]=o.default.useState("render"),[X,O]=o.default.useState(!1),ce=o.default.useRef(null),le=o.default.useRef(null),fe=o.default.useRef(!1);if(o.default.useEffect(()=>{O(!1)},[t]),o.default.useEffect(()=>{if(X){fe.current=!0;let v=ce.current;v&&typeof v.focus=="function"&&v.focus();let A=ue=>{ue.key==="Escape"&&O(!1)};return window.addEventListener("keydown",A),()=>window.removeEventListener("keydown",A)}if(fe.current){fe.current=!1;let v=le.current;v&&typeof v.focus=="function"&&v.focus()}},[X]),o.default.useEffect(()=>{if(!t)return;let v=!0;return H("render"),y(!0),ke(""),_(""),ge(!1),Promise.all([ri(t),oi(t,{maxChars:ii}).catch(()=>null)]).then(([A,ue])=>{if(!v)return;let re=A?.item??A??null;if(!re){ke(e("errorPrefix")),y(!1);return}let Le=ue??(A?.content?{text:A.content,totalLines:re.lines,truncated:!1}:null),Fe=mt(re,Le);$(re),Y(Le),u(Fe),k(Fe),y(!1),te(null);let Qe=String(re.ext||"");Ri.test(Qe)?(ae(!0),di(t,{maxChars:ii}).then(d=>{v&&te(d)}).catch(()=>{v&&te({kind:"none"})}).finally(()=>{v&&ae(!1)})):ae(!1)}).catch(A=>{v&&(y(!1),ke(A?.message??String(A)),p(A))}),()=>{v=!1}},[t,j,S,e,p]),!t)return i("aside",{className:"clib-detail"},i("div",{className:"clib-placeholder"},i("div",{className:"clib-empty-icon"},i(N,{name:"book",size:22})),i("b",null,e("detailEmpty")),i("p",null,e("detailEmptyBody"))));let D=c?.status==="trashed",Se=!!h&&!!R&&(h.title!==R.title||h.collection!==R.collection||h.tags!==R.tags||h.notes!==R.notes||c?.storage==="note"&&h.content!==R.content),he=!!c&&(c.kind==="image"||String(c.mime??"").startsWith("image/")),J=L?.text??c?.preview??"",de=J?J.split(`
`):[],ee=de.slice(0,Ei),Me=de.length>Ei,xe=L?.totalLines??c?.lines??de.length,ve=L?.truncated||Me,ze=L?.binary===!0,ye=!!c&&(c.kind==="note"||c.storage==="note"||/^md$/i.test(String(c.ext||""))),ie=c?.sourceId?n[c.sourceId]??c.sourceId:"",be=v=>A=>{let ue=A.target.value;k(re=>re&&{...re,[v]:ue})};async function Z(){if(!c||!h||z)return;let v={title:h.title.trim()||e("untitled"),collection:h.collection.trim()||"inbox",tags:lt(h.tags),notes:h.notes};c.storage==="note"&&h.content!==R.content&&(v.content=h.content),G("save");try{await Ee(t,v),m({type:"ok",title:e("saved")}),P(A=>A+1),b()}catch(A){p(A)}finally{G("")}}async function q(){if(!c||!Q||z)return;let v=Q==="purge";G(v?"purge":"delete");try{v?(await mi(t),m({type:"ok",title:e("purgeDone")})):(await pi(t),m({type:"ok",title:e("deleteDone")})),_(""),b(),l()}catch(A){p(A)}finally{G("")}}async function we(){if(!z){G("restore");try{await ui(t),m({type:"ok",title:e("restored")}),b(),l()}catch(v){p(v)}finally{G("")}}}async function se(v,A){let ue=await st(v);return m(ue?{type:"ok",title:e("copied")}:{type:"error",title:e("errorPrefix"),message:e("copyFailed")}),ue&&A}async function ne(){if(!(!c||z)){G("reveal");try{await gi(c.id),m({type:"ok",title:e("revealed")})}catch(v){p(v)}finally{G("")}}}let g=c?he?i("div",{className:"clib-image-wrap"},Ne?i("span",{className:"clib-hint"},e("previewFailed")):i("img",{src:ci(c.id),alt:c.title||e("imagePreview"),loading:"lazy",onError:()=>ge(!0)})):Ri.test(String(c.ext||""))?oe?i("div",{className:"clib-hint"},e("loading")):V?.kind==="text"?i("div",{className:"clib-doc-text"},i("pre",{className:"clib-code"},String(V.text||"").slice(0,ii)),V.note?i("div",{className:"clib-hint"},V.note):null):V?.kind==="thumb"?i("div",{className:"clib-image-wrap"},i("img",{src:Be(c.id),alt:c.title||e("fieldContent"),loading:"lazy",onError:()=>ge(!0)})):i("div",{className:"clib-hint"},V?.note||e("binaryPreview")):ze?i("div",{className:"clib-hint"},e("binaryPreview")):J?ye&&F==="render"?i(Re,{text:J,className:"is-plain"}):i("div",{className:"clib-code-wrap"},i("pre",{className:"clib-code-gutter"},ee.map((v,A)=>A+1).join(`
`)),i("pre",{className:"clib-code"},ee.join(`
`))):null:null,x=()=>ye?i("div",{className:"clib-fs-modes",role:"group","aria-label":e("fieldContent")},i("button",{type:"button",className:`clib-fs-mode${F==="render"?" is-on":""}`,"aria-pressed":F==="render",onClick:()=>H("render")},e("mdRender")),i("button",{type:"button",className:`clib-fs-mode${F==="source"?" is-on":""}`,"aria-pressed":F==="source",onClick:()=>H("source")},e("mdSource"))):null,K=i("div",{className:"clib-detail-head"},i(N,{name:c?_e(c.kind):"doc",size:18}),i("div",{className:"clib-detail-titles"},i("h2",null,c?.title||e("loadingDetail")),i("div",{className:"clib-detail-sub"},c?i("span",{className:"clib-badge"},e(Pe[c.kind]??"kindOther")):null,c?.storage?i("span",{className:"clib-badge"},e(`storage${c.storage[0].toUpperCase()}${c.storage.slice(1)}`)):null,ie?i("span",null,ie):null,c?i("span",null,Ge(c.size)):null,c?i("span",null,qe(c.updatedAt)):null)),i("button",{type:"button",className:"clib-btn clib-icon",onClick:l,title:e("close"),"aria-label":e("close")},i(N,{name:"close",size:13}))),pe;f?pe=i("div",{className:"clib-placeholder"},i("b",null,e("loadingDetail"))):T?pe=i("div",{className:"clib-placeholder"},i("b",null,e("errorPrefix")),i("p",null,T)):!c||!h?pe=i("div",{className:"clib-placeholder"},i("b",null,e("detailEmpty"))):pe=i(o.default.Fragment,null,i("div",{className:"clib-field"},i("label",{htmlFor:"clib-title"},e("fieldTitle")),i("input",{id:"clib-title",className:"clib-input",value:h.title,disabled:D,onChange:be("title")})),i("div",{className:"clib-field"},i("label",{htmlFor:"clib-collection"},e("fieldCollection")),i("input",{id:"clib-collection",className:"clib-input",value:h.collection,disabled:D,list:"clib-collection-options",onChange:be("collection")}),i("datalist",{id:"clib-collection-options"},(a??[]).map(v=>i("option",{key:v.name,value:v.name})))),i("div",{className:"clib-field"},i("label",{htmlFor:"clib-tags"},e("fieldTags"),i("small",null,e("fieldTagsHint"))),i("input",{id:"clib-tags",className:"clib-input",value:h.tags,disabled:D,onChange:be("tags")})),i("div",{className:"clib-field"},i("label",{htmlFor:"clib-notes"},e("fieldNotes")),i("textarea",{id:"clib-notes",className:"clib-textarea",rows:2,value:h.notes,disabled:D,placeholder:e("fieldNotesPlaceholder"),onChange:be("notes")})),c.storage==="note"?i("div",{className:"clib-field"},i("label",{htmlFor:"clib-content"},e("fieldContent")),i("textarea",{id:"clib-content",className:"clib-textarea",rows:6,value:h.content,disabled:D,spellCheck:!1,onChange:be("content")})):null,c.path?i("div",{className:"clib-field"},i("label",null,e("pathLabel")),i("div",{className:"clib-path-row"},i("code",{className:"clib-path-line",title:c.path},c.path),i("button",{type:"button",className:"clib-icon-btn",title:e("copyPath"),"aria-label":e("copyPath"),onClick:()=>se(c.path,"path")},i(N,{name:"copy",size:12})),i("button",{type:"button",className:"clib-icon-btn",title:e("revealInFinder"),"aria-label":e("revealInFinder"),disabled:!!z,onClick:ne},i(N,{name:"folder",size:12})))):null,D?i("div",{className:"clib-hint"},e("trashHint")):null,i("div",{className:"clib-preview"},i("div",{className:"clib-preview-head"},i("span",null,e(he?"imagePreview":"fieldContent")),i("span",{className:"clib-preview-tools"},ye?i("span",{className:"clib-seg clib-seg-sm"},i("button",{type:"button",className:`clib-seg-btn${F==="render"?" is-on":""}`,"aria-pressed":F==="render",onClick:()=>H("render")},e("mdRender")),i("button",{type:"button",className:`clib-seg-btn${F==="source"?" is-on":""}`,"aria-pressed":F==="source",onClick:()=>H("source")},e("mdSource"))):null,i("span",null,he?`${Ge(c.size)}`:ve?`${I(e("linesTotal"),{n:xe})} \xB7 ${e("truncated")}`:J?I(e("linesTotal"),{n:xe}):""),i("button",{type:"button",className:"clib-icon-btn clib-fs-open",ref:le,title:e("previewFullscreen"),"aria-label":e("previewFullscreen"),"aria-expanded":X,onClick:()=>O(!0)},i(N,{name:"expand",size:12})))),g),Q?i("div",{className:"clib-confirm"},i("b",null,Q==="purge"?I(e("purgeConfirm"),{title:c.title}):I(e("deleteConfirm"),{title:c.title})),i("p",null,Q==="purge"?e("purgeConfirmBody"):`${e("deleteConfirmBody")}${c.storage==="linked"?` ${e("deleteConfirmLinked")}`:""}`),i("div",{className:"clib-confirm-row"},i("button",{type:"button",className:"clib-btn",onClick:()=>_(""),disabled:!!z},e("cancel")),i("button",{type:"button",className:"clib-btn is-danger",onClick:q,disabled:!!z},e(z?"deleting":Q==="purge"?"purge":"delete")))):null);let Ce=i("div",{className:"clib-detail-foot"},D?i(o.default.Fragment,null,i("button",{type:"button",className:"clib-btn is-primary",disabled:!!z,onClick:we},i(N,{name:"restore",size:13}),e("restore")),i("span",{className:"clib-grow"}),i("button",{type:"button",className:"clib-btn is-danger",disabled:!!z,onClick:()=>_("purge")},i(N,{name:"trash",size:13}),e("purge"))):i(o.default.Fragment,null,i("button",{type:"button",className:"clib-btn is-primary",disabled:!!z||!Se,onClick:Z},i(N,{name:"save",size:13}),e(z==="save"?"saving":"save")),i("button",{type:"button",className:"clib-btn",disabled:!c?.path||!!z,title:c?.path?c.path:e("noPath"),onClick:()=>se(c?.path??"","path")},i(N,{name:"copy",size:13}),e("copyPath")),i("button",{type:"button",className:"clib-btn",disabled:!c?.path||!!z,title:c?.path?e("revealInFinder"):e("noPath"),onClick:ne},i(N,{name:"folder",size:13}),e(z==="reveal"?"revealing":"revealInFinder")),i("button",{type:"button",className:"clib-btn",disabled:!J||!!z,onClick:()=>se(J,"content")},i(N,{name:"copy",size:12}),e("copyContent")),i("span",{className:"clib-grow"}),i("button",{type:"button",className:"clib-btn is-danger",disabled:!!z||!c,onClick:()=>_("delete")},i(N,{name:"trash",size:13}),e("delete")))),Ye=X?i("div",{className:"clib-fs",role:"dialog","aria-modal":"true","aria-label":e("previewFullscreen"),onMouseDown:v=>{v.target===v.currentTarget&&O(!1)}},i("div",{className:"clib-fs-card"},i("div",{className:"clib-fs-head"},i("span",{className:"clib-fs-title"},e(he?"imagePreview":"fieldContent")),i("span",{className:"clib-fs-tools"},x(),i("button",{type:"button",className:"clib-icon-btn clib-fs-close",ref:ce,title:e("previewFullscreenExit"),"aria-label":e("previewFullscreenExit"),onClick:()=>O(!1)},i(N,{name:"collapse",size:13})))),i("div",{className:"clib-fs-body"},g))):null;return i(o.default.Fragment,null,i("aside",{className:"clib-detail is-open"},K,i("div",{className:"clib-detail-body"},pe),Ce),Ye)}function ft({t:e,defaultCollection:t,busy:a,onClose:n,onCreate:l}){let[b,m]=o.default.useState(""),[p,S]=o.default.useState("");return o.default.useEffect(()=>{let f=y=>{y.key==="Escape"&&n()};return window.addEventListener("keydown",f),()=>window.removeEventListener("keydown",f)},[n]),i("div",{className:"clib-overlay",onMouseDown:f=>{f.target===f.currentTarget&&n()}},i("form",{className:"clib-dialog",onSubmit:f=>{f.preventDefault(),a||l({title:b,content:p})}},i("h3",null,e("newNote")),i("input",{className:"clib-input",value:b,placeholder:e("noteTitlePlaceholder"),"aria-label":e("noteTitlePlaceholder"),autoFocus:!0,onChange:f=>m(f.target.value)}),i("textarea",{className:"clib-textarea",value:p,placeholder:e("noteContentPlaceholder"),"aria-label":e("noteContentPlaceholder"),onChange:f=>S(f.target.value)}),i("div",{className:"clib-dialog-actions"},i("button",{type:"button",className:"clib-btn",onClick:n,disabled:a},e("cancel")),i("button",{type:"submit",className:"clib-btn is-primary",disabled:a},e(a?"creating":"create")))))}function ht({t:e,toasts:t,onDismiss:a}){return i("div",{className:"clib-toasts"},t.map(n=>i("div",{key:n.id,className:`clib-toast is-${n.type??"ok"}`,role:"status"},i("div",{className:"clib-toast-top"},i("span",{className:"clib-toast-title"},n.title??""),i("button",{type:"button",className:"clib-toast-close",onClick:()=>a(n.id),title:e("close"),"aria-label":e("close")},i(N,{name:"close",size:11}))),n.message?i("div",{className:"clib-toast-body"},n.message):null,n.lines?.length?i("div",{className:"clib-toast-body"},n.lines.map((l,b)=>i("div",{key:b,className:`clib-toast-line${l.bad?" is-bad":""}`},l.text))):null)))}var xt=0;function Li({t:e,onExit:t}){let[a,n]=o.default.useState(null),[l,b]=o.default.useState([]),[m,p]=o.default.useState([]),[S,f]=o.default.useState(0),[y,j]=o.default.useState(null),[P,c]=o.default.useState(!0),[$,L]=o.default.useState(!1),[Y,R]=o.default.useState(!1),[u,h]=o.default.useState(!1),[k,T]=o.default.useState(null),[ke,z]=o.default.useState(!1),[G,Q]=o.default.useState(!1),[_,Ne]=o.default.useState(""),[ge,V]=o.default.useState(""),[te,oe]=o.default.useState(""),[ae,F]=o.default.useState("relevance"),[H,X]=o.default.useState("active"),[O,ce]=o.default.useState(""),[le,fe]=o.default.useState(""),[D,Se]=o.default.useState(""),[he,J]=o.default.useState(()=>{let d=Ai("clib:view","list");return Ke.includes(d)?d:"list"}),[de,ee]=o.default.useState(()=>Ai("clib:assist","0")==="1"),[Me,xe]=o.default.useState(0),ve=Ke.includes(he)?he:"list";o.default.useEffect(()=>{Mi("clib:view",ve)},[ve]),o.default.useEffect(()=>{Mi("clib:assist",de?"1":"0")},[de]);let ze=o.default.useMemo(()=>m.find(d=>d.id===k)??null,[m,k]);function ye(d){if(!(!d||typeof d!="object")){if(H==="trashed"&&X("active"),"q"in d){let C=d.q==null?"":String(d.q);Ne(C),V(C)}"kind"in d&&oe(d.kind||""),"collection"in d&&fe(d.collection||""),"tag"in d&&Se(d.tag||"")}}let ie=o.default.useRef(0),be=o.default.useRef(m);o.default.useEffect(()=>{be.current=m},[m]);let Z=o.default.useCallback(d=>{let C=++xt;b(U=>[...U.slice(-3),{id:C,...d}]);let M=d.ttl??(d.type==="error"?6500:3800);M>0&&setTimeout(()=>b(U=>U.filter(Te=>Te.id!==C)),M)},[]),q=o.default.useCallback(d=>{Z({type:"error",title:e("errorPrefix"),message:d?.message??String(d??"")})},[Z,e]);o.default.useEffect(()=>{let d=setTimeout(()=>V(_.trim()),250);return()=>clearTimeout(d)},[_]);let we=o.default.useCallback(async()=>{try{n(await si())}catch(d){q(d)}},[q]),se=o.default.useCallback(async d=>{let C=++ie.current;d?L(!0):c(!0);let M=d?be.current.length:0;try{let U=H==="trashed"?await vi({limit:Ti,offset:M}):await ni({q:ge,kind:te,collection:le,tag:D,source:O,sort:ae,status:"active",limit:Ti,offset:M});if(C!==ie.current)return;let Te=U?.items??[];p(W=>d?[...W,...Te]:Te),f(U?.total??0),!d&&U?.facets&&j(U.facets)}catch(U){C===ie.current&&q(U)}finally{C===ie.current&&(c(!1),L(!1))}},[H,ge,te,le,D,O,ae,q]);o.default.useEffect(()=>{T(null),se(!1)},[se]),o.default.useEffect(()=>{we()},[we]);let ne=o.default.useMemo(()=>{let d=a?.sources??[],C=new Map((a?.stats?.sources??[]).map(M=>[M.id,M]));return d.length?d.map(M=>{let U=C.get(M.id);return{...M,count:U?.count??M.count??0,lastScanAt:U?.lastScanAt??M.lastScanAt}}):a?.stats?.sources??[]},[a]),r=o.default.useMemo(()=>{let d={};for(let C of ne)d[C.id]=C.name;return d},[ne]),g=y?.collections??a?.stats?.collections??[],x=y?.tags??a?.stats?.tags??[],K=a?.trashCount??0,pe=!!(ge||te||le||D||O);async function Ce(){R(!0);try{await Promise.all([we(),se(!1)])}finally{R(!1)}}async function Ye(){await Ce(),xe(d=>d+1)}async function v(){if(!u){h(!0);try{let d=await fi({}),C=d?.results??d??[];if(!C?.length)Z({type:"warn",title:e("scanDone"),message:e("scanNoSources")});else{let M=[],U=!1;for(let W of C){let Xe=W.errors?.length??0;Xe&&(U=!0),M.push({text:I(e("scanResult"),{name:r[W.sourceId]??W.sourceId??"?",added:W.added??0,updated:W.updated??0,removed:W.removed??0,skipped:W.skipped??0,errors:Xe}),bad:Xe>0})}let Te=C.flatMap(W=>W.errors??[]).slice(0,3).map(W=>({text:I(e("scanErrorLine"),{path:W.path??"",message:W.message??""}),bad:!0}));Z({type:U?"warn":"ok",title:e("scanDone"),lines:[...M,...Te],ttl:9e3})}await Ce()}catch(d){q(d)}finally{h(!1)}}}async function A(d){try{let C=await hi(d);return await we(),Z({type:"ok",title:I(e("sourceAdded"),{name:C?.source?.name??d.name})}),!0}catch(C){return q(C),!1}}async function ue(d){if(window.confirm(I(e("removeSourceConfirm"),{name:d.name})))try{await xi(d.id),O===d.id&&ce(""),await Promise.all([we(),se(!1)]),Z({type:"ok",title:e("sourceRemoved")})}catch(M){q(M)}}async function re(d){if(!G){Q(!0);try{let C=await bi({title:d.title.trim()||e("untitled"),content:d.content,kind:"note",collection:le||"inbox",tags:D?[D]:[]}),M=C?.item??C;z(!1),Z({type:"ok",title:e("noteCreated")}),await Ce(),M?.id&&T(M.id)}catch(C){q(C)}finally{Q(!1)}}}function Le(d){H!=="trashed"&&("source"in d&&ce(d.source),"collection"in d&&fe(d.collection),"tag"in d&&Se(d.tag))}function Fe(){Ne(""),V(""),oe(""),fe(""),Se(""),ce("")}function Qe(){X(d=>d==="trashed"?"active":"trashed"),T(null)}return i("div",{className:"clib-root"},i(nt,{t:e,qInput:_,onQuery:Ne,onExit:t,kind:te,onKind:oe,sort:ae,onSort:F,status:H,trashCount:K,onToggleTrash:Qe,onScan:v,scanning:u,onNewNote:()=>z(!0),onRefresh:Ce,refreshing:Y,view:ve,onView:J,assistOpen:de,onToggleAssist:()=>ee(d=>!d)}),i("div",{className:"clib-body"},i(rt,{t:e,sources:ne,collections:g,tags:x,filters:{source:O,collection:le,tag:D},disabled:H==="trashed",onFilter:Le,onAddSource:A,onRemoveSource:ue}),i(ut,{t:e,items:m,total:S,loading:P,moreLoading:$,selectedId:k,onSelect:T,onLoadMore:()=>se(!0),status:H,hasFilters:pe,onClearFilters:Fe,sourceNames:r,onNewNote:()=>z(!0),view:ve,sort:ae,onSort:F}),i(gt,{t:e,id:k,collections:g,sourceNames:r,onClose:()=>T(null),onChanged:Ce,version:Me,pushToast:Z,toastError:q}),i(zi,{t:e,Icon:N,open:de,onClose:()=>ee(!1),item:ze,items:m,onApplyFilters:ye,onChanged:Ye,pushToast:Z,toastError:q})),ke?i(ft,{t:e,defaultCollection:le,busy:G,onClose:()=>z(!1),onCreate:re}):null,i(ht,{t:e,toasts:l,onDismiss:d=>b(C=>C.filter(M=>M.id!==d))}))}var vt=String.raw`
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
.clib-select{
  height: 30px; cursor: pointer; max-width: 150px; min-width: 0; padding: 0 24px 0 10px;
  border-radius: 999px; appearance: none; -webkit-appearance: none; text-overflow: ellipsis;
  background-color: var(--clib-card);
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='10'%20height='6'%20viewBox='0%200%2010%206'%3E%3Cpath%20d='M1%201l4%204%204-4'%20fill='none'%20stroke='%236b7280'%20stroke-width='1.4'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 9px center; background-size: 9px 6px;
}
html[data-theme='dark'] .clib-select, body[data-ds-dark-theme] .clib-select{
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='10'%20height='6'%20viewBox='0%200%2010%206'%3E%3Cpath%20d='M1%201l4%204%204-4'%20fill='none'%20stroke='%239aa3ad'%20stroke-width='1.4'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E");
}
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
.clib-body{ flex: 1; min-height: 0; display: grid; position: relative; grid-template-columns: 214px minmax(0, 1fr) minmax(320px, 408px); }
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

/* ---------------------------------------------------------------- 全屏预览 */
.clib-fs{
  position: absolute; inset: 0; z-index: 50;
  display: flex; align-items: stretch; justify-content: center;
  background: rgb(0 0 0 / .40); backdrop-filter: blur(2px);
  animation: clib-fs-fade .14s ease-out;
}
@keyframes clib-fs-fade{ from{ opacity: 0; } to{ opacity: 1; } }
.clib-fs-card{
  position: relative; flex: 1; min-width: 0; min-height: 0; margin: 14px;
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: var(--clib-r-lg); border: .5px solid var(--clib-line-strong);
  background: var(--clib-bg); color: var(--clib-ink);
  box-shadow: 0 24px 70px rgb(0 0 0 / .35), 0 2px 8px rgb(0 0 0 / .18);
}
.clib-fs-head{
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 9px 10px 9px 14px; border-bottom: .5px solid var(--clib-line);
  background: color-mix(in srgb, var(--clib-card) 76%, transparent);
}
.clib-fs-title{
  flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: var(--clib-ink2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.clib-fs-tools{ flex: none; display: inline-flex; align-items: center; gap: 8px; }
.clib-fs-close{ width: 24px; height: 24px; border-radius: 7px; }
.clib-fs-modes{
  display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px;
  border: .5px solid var(--clib-line); background: var(--clib-card);
}
.clib-fs-mode{
  height: 22px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent;
  color: var(--clib-ink3); font: inherit; font-size: 11px; cursor: pointer;
}
.clib-fs-mode:hover{ color: var(--clib-ink); }
.clib-fs-mode.is-on{ background: var(--clib-bg); color: var(--clib-accent); font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
.clib-fs-mode:focus-visible{ outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 30%, transparent); }
.clib-fs-body{
  flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto;
  padding: 14px 16px 18px;
}
.clib-fs-body .clib-code-wrap{ max-height: none; overflow: visible; flex: none; }
.clib-fs-body .clib-doc-text{ max-height: none; overflow: visible; flex: none; }
.clib-fs-body .clib-image-wrap{ flex: 1; min-height: 0; }
.clib-fs-body .clib-image-wrap img{ max-height: 100%; }
.clib-fs-body .clib-hint{ flex: none; }
.clib-fs-open{ color: var(--clib-ink3); }
.clib-fs-open:hover{ color: var(--clib-accent); }

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

/* ---------------------------------------------------------------- 视图：分段控件 / 卡片 / 表格 / 图库 */
.clib-seg{
  display: inline-flex; align-items: center; gap: 2px; padding: 2px;
  border: .5px solid var(--clib-line); border-radius: 999px; background: var(--clib-card);
}
.clib-seg-btn{
  height: 24px; padding: 0 9px; border: 0; border-radius: 999px; background: transparent;
  color: var(--clib-ink3); font-size: 11px; font-family: inherit; cursor: pointer; white-space: nowrap;
}
.clib-seg-btn:hover{ color: var(--clib-ink); }
.clib-seg-btn.is-on{ background: var(--clib-bg); color: var(--clib-ink); font-weight: 600; box-shadow: 0 1px 3px rgb(0 0 0 / .12); }
.clib-seg-sm{ padding: 1px; }
.clib-seg-sm .clib-seg-btn{ height: 20px; padding: 0 7px; font-size: 10.5px; }

.clib-cards{
  display: grid; gap: 10px; padding: 12px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
}
.clib-card{
  display: flex; flex-direction: column; min-width: 0; padding: 0; overflow: hidden; text-align: left;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r-lg); background: var(--clib-bg);
  color: inherit; font-family: inherit; cursor: pointer;
}
.clib-card:hover{ border-color: var(--clib-line-strong); box-shadow: 0 6px 18px rgb(0 0 0 / .09); }
.clib-card.is-on{ border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 22%, transparent); }
.clib-card-thumb{
  position: relative; flex: none; height: 104px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; overflow: hidden; border-bottom: .5px solid var(--clib-line); background: var(--clib-card);
}
.clib-card-thumb img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.clib-card-glyph{ color: var(--clib-ink3); display: flex; }
.clib-card-snippet{
  font-size: 10px; line-height: 1.4; color: var(--clib-ink3); padding: 0 10px; text-align: center;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
.clib-card-body{ display: flex; flex-direction: column; gap: 5px; padding: 8px 10px 10px; min-width: 0; }
.clib-card-title{
  font-size: 12.5px; font-weight: 600; line-height: 1.35; color: var(--clib-ink); word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.clib-card-meta{ display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 10px; color: var(--clib-ink3); }
.clib-card-tags{ display: flex; flex-wrap: wrap; gap: 4px; }

.clib-table-wrap{ min-height: 100%; }
.clib-table{ width: 100%; border-collapse: collapse; font-size: 11.5px; }
.clib-table th{
  position: sticky; top: 0; z-index: 1; height: 30px; padding: 0 10px; text-align: left; font-weight: 600;
  background: var(--clib-bg); border-bottom: .5px solid var(--clib-line-strong); color: var(--clib-ink3); white-space: nowrap;
}
.clib-table th.clib-th-sort{ padding: 0; }
.clib-table th .clib-th-btn{
  display: inline-flex; align-items: center; gap: 3px; width: 100%; height: 30px; padding: 0 10px;
  border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left;
}
.clib-table th .clib-th-btn:hover, .clib-table th .clib-th-btn.is-on{ color: var(--clib-ink); }
.clib-sort-mark{ font-size: 9px; color: var(--clib-accent); }
.clib-table td{ padding: 7px 10px; border-bottom: .5px solid var(--clib-line); vertical-align: top; color: var(--clib-ink2); }
.clib-table tbody tr{ cursor: pointer; }
.clib-table tbody tr:hover{ background: var(--clib-hover); }
.clib-table tbody tr.is-on{ background: var(--clib-active); }
.clib-table tbody tr.is-on .clib-td-title strong{ color: var(--clib-accent); }
.clib-td-title{ color: var(--clib-ink); }
.clib-td-title-row{ display: flex; align-items: flex-start; gap: 5px; }
.clib-td-title-row svg{ flex: none; margin-top: 2px; color: var(--clib-ink3); }
.clib-td-title-row strong{ font-weight: 600; word-break: break-word; }
.clib-table .clib-num{ white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--clib-ink3); font-size: 10.5px; }
.clib-table-tags{ display: inline-flex; flex-wrap: wrap; gap: 3px; }

.clib-gallery{
  display: grid; gap: 10px; padding: 12px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.clib-gal{
  position: relative; aspect-ratio: 4 / 3; overflow: hidden; padding: 0; cursor: pointer;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
}
.clib-gal:hover{ border-color: var(--clib-line-strong); }
.clib-gal.is-on{ border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 22%, transparent); }
.clib-gal img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.clib-gal-cap{
  position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 8px 6px; color: #fff; font-size: 10px;
  text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: linear-gradient(transparent, rgb(0 0 0 / .68));
}

/* ---------------------------------------------------------------- Markdown 渲染 */
.clib-md{
  max-height: 360px; overflow: auto; padding: 10px 12px; font-size: 12.5px; line-height: 1.62;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
  color: var(--clib-ink); word-break: break-word;
}
.clib-md.is-plain{ max-height: 300px; padding: 0; border: 0; background: transparent; }
.clib-md > :first-child{ margin-top: 0; }
.clib-md > :last-child{ margin-bottom: 0; }
.clib-md h1, .clib-md h2, .clib-md h3, .clib-md h4, .clib-md h5, .clib-md h6{
  margin: 12px 0 6px; line-height: 1.35; color: var(--clib-ink);
}
.clib-md h1{ font-size: 17px; } .clib-md h2{ font-size: 15px; } .clib-md h3{ font-size: 13.5px; }
.clib-md h4, .clib-md h5, .clib-md h6{ font-size: 12.5px; }
.clib-md p{ margin: 0 0 8px; }
.clib-md ul, .clib-md ol{ margin: 0 0 8px; padding-left: 20px; }
.clib-md li{ margin: 2px 0; }
.clib-md code{
  font-family: var(--clib-mono); font-size: 10.5px; padding: 1px 4px; border-radius: 4px;
  background: var(--clib-layer); border: .5px solid var(--clib-line);
}
.clib-md pre{
  margin: 0 0 8px; padding: 8px 10px; overflow: auto; border-radius: 6px;
  background: var(--clib-layer); border: .5px solid var(--clib-line);
}
.clib-md pre code{ padding: 0; border: 0; background: none; font-size: 11px; line-height: 1.55; white-space: pre; }
.clib-md a{ color: var(--clib-accent); text-decoration: none; }
.clib-md a:hover{ text-decoration: underline; }
.clib-md strong{ font-weight: 650; }
.clib-preview-tools{ display: inline-flex; align-items: center; gap: 8px; flex: none; }

/* ---------------------------------------------------------------- 助手抽屉 */
.clib-assist{
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; width: 360px; max-width: 100%;
  display: flex; flex-direction: column; background: var(--clib-bg);
  border-left: .5px solid var(--clib-line-strong); box-shadow: -20px 0 54px rgb(0 0 0 / .2);
  animation: clib-assist-in .16s ease-out;
}
@keyframes clib-assist-in{ from{ opacity: 0; transform: translateX(14px); } to{ opacity: 1; transform: none; } }
.clib-assist-head{
  flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 10px 10px 10px 12px;
  border-bottom: .5px solid var(--clib-line);
}
.clib-assist-head > svg{ flex: none; margin-top: 2px; color: var(--clib-accent); }
.clib-assist-titles{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.clib-assist-titles b{ font-size: 13px; font-weight: 650; color: var(--clib-ink); }
.clib-assist-titles small{ font-size: 10px; line-height: 1.4; color: var(--clib-ink3); word-break: break-word; }
.clib-assist-tabs{ flex: none; display: flex; gap: 2px; padding: 0 8px; border-bottom: .5px solid var(--clib-line); }
.clib-assist-tab{
  flex: 1; height: 34px; padding: 0; border: 0; border-bottom: 2px solid transparent;
  background: transparent; color: var(--clib-ink3); font-family: inherit; font-size: 12px; cursor: pointer;
}
.clib-assist-tab:hover{ color: var(--clib-ink); }
.clib-assist-tab.is-on{ color: var(--clib-accent); border-bottom-color: var(--clib-accent); font-weight: 600; }
.clib-assist-body{
  flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px;
}
.clib-assist-pane{ display: flex; flex-direction: column; gap: 10px; }
.clib-assist-hint{ font-size: 11.5px; line-height: 1.55; color: var(--clib-ink3); }
.clib-assist-warn{
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: var(--clib-r);
  border: .5px solid color-mix(in srgb, var(--clib-warn) 45%, transparent);
  background: color-mix(in srgb, var(--clib-warn) 8%, transparent);
  color: var(--clib-ink2); font-size: 11.5px; line-height: 1.5;
}
.clib-assist-warn span{ flex: 1; min-width: 0; word-break: break-word; }
.clib-assist-card{
  display: flex; flex-direction: column; gap: 8px; padding: 10px;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
}
.clib-assist-card-head{ display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--clib-ink3); }
.clib-assist-card-head b{ font-size: 11px; color: var(--clib-ink2); }
.clib-assist-meta{ font-size: 9.5px; color: var(--clib-ink3); }
.clib-assist-actions{ display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.clib-assist-actions .clib-grow{ flex: 1; }
.clib-assist-change{ display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-top: .5px solid var(--clib-line); }
.clib-assist-change:first-child{ border-top: 0; padding-top: 0; }
.clib-assist-change-main{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.clib-assist-change-label{ font-size: 9.5px; letter-spacing: .3px; text-transform: uppercase; color: var(--clib-ink3); }
.clib-assist-change-value{ font-size: 11.5px; color: var(--clib-ink); word-break: break-word; }
.clib-assist-done{ display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--clib-ok); }
.clib-assist-error{ font-size: 10.5px; line-height: 1.45; color: var(--clib-danger); word-break: break-word; }
.clib-assist-empty{ padding: 14px 8px; text-align: center; font-size: 11.5px; line-height: 1.5; color: var(--clib-ink3); }
.clib-assist-ask{ display: flex; gap: 6px; }
.clib-assist-ask .clib-input{ flex: 1; min-width: 0; }
.clib-assist-table{ width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
.clib-assist-table th{
  padding: 0 4px 4px; text-align: left; font-weight: 600; color: var(--clib-ink3);
  border-bottom: .5px solid var(--clib-line); white-space: nowrap;
}
.clib-assist-table td{ padding: 6px 4px; vertical-align: top; border-bottom: .5px solid var(--clib-line); color: var(--clib-ink2); word-break: break-word; }
.clib-assist-table tr.is-done td{ opacity: .72; }
.clib-assist-td-title{ color: var(--clib-ink); font-weight: 600; }
.clib-assist-td-reason{ color: var(--clib-ink3); line-height: 1.45; }
.clib-assist-td-action{ white-space: nowrap; }
.clib-assist-error-row{ padding-top: 0; color: var(--clib-danger); line-height: 1.45; }
.clib-assist-tags{ display: flex; flex-wrap: wrap; gap: 3px; }
.clib-assist-result{ display: flex; flex-direction: column; gap: 6px; }
.clib-spin-inline{ display: inline-flex; align-items: center; }
@media (max-width: 720px){
  .clib-assist{ width: 100%; }
}

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
  .clib-select{ max-width: 124px; }
  .clib-fs-card{ margin: 8px; }
  .clib-fs-head{ padding: 8px 8px 8px 12px; }
  .clib-fs-body{ padding: 10px 12px 14px; }
  .clib-fs-mode{ padding: 0 8px; font-size: 10.5px; }
}
`;function Fi(e=document){let t="clib-styles";e.getElementById(t)?.remove();let a=e.createElement("style");return a.id=t,a.textContent=vt,e.head.appendChild(a),()=>a.remove()}var Ii="context-lib",Oi="context-lib",We={t:e=>e},ti=()=>{};function yt({size:e=16}){return Ae.default.createElement("svg",{width:e,height:e,viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:1.4,strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":!0},Ae.default.createElement("path",{d:"M2 3.2h3.7c1.2 0 2.2.7 2.3 1.8v8c-.4-1.1-1.4-1.8-2.6-1.8H2z"}),Ae.default.createElement("path",{d:"M8 5c.1-1.1 1.1-1.8 2.3-1.8H14v8h-3.7c-1.2 0-2.2.7-2.6 1.8"}),Ae.default.createElement("path",{d:"M3 6.4h2.6M3 8.8h2.6"}))}function wt(){return Ae.default.createElement(Li,{t:We.t,onExit:ti})}function kt(e){We.t=typeof e.locale?.bind=="function"?e.locale.bind(Ii):a=>a,ti=()=>{try{let a=e.get("layout");typeof a?.selectPanel=="function"&&a.selectPanel(null)}catch(a){console.error("[context-lib] \u8FD4\u56DE\u5BF9\u8BDD\u5931\u8D25\uFF1A",a)}},e.effect(()=>e.locale.register(Ii,{zh:ki,en:Ni}),"context-lib: dictionaries"),e.effect(()=>Fi(document),"context-lib: styles"),e.effect(()=>()=>{We={t:a=>a},ti=()=>{}},"context-lib: teardown");let t=(a,n)=>{try{n()}catch(l){console.error(`[context-lib] ${a} \u6CE8\u518C\u5931\u8D25\uFF1A`,l)}};t("\u4FA7\u680F\u5165\u53E3",()=>e.slots.inject("sidebar.panellist",()=>e.slots.register({name:"sidebar.panellist",id:Oi,order:7,label:()=>We.t("panelTitle")},yt))),t("\u4E3B\u9875\u9762",()=>e.slots.inject("main",()=>e.slots.register({name:"main",key:Oi},wt)))}var Nt=["slots","locale"];

    return module.exports;
  },
});
