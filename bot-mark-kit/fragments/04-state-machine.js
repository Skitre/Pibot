// fragment: 04-state-machine
// anchor: "XFt=[{label:\"Lifecycle\""
// bytes: [936654, 937554) of index-DVUCYGay.js (6242032 total)
// State groups: Lifecycle(7) / Reactions(16) / Agent morphs(3) / Product lifecycle(13) = 39 states listed.
// PROPRIETARY (Anysphere) — carved verbatim from the minified bundle FOR LOCAL STUDY ONLY.
// Do NOT copy into any project.

XFt=[{label:"Lifecycle",states:["sleeping","waking","idle","listening","thinking","searching","working"]},{label:"Reactions",states:["excited","surprised","suspicious","angry","drowsy","happy","curious","confused","bored","proud","shy","sad","laughing","scared","playful","celebrate"]},{label:"Agent morphs",states:["orbit","radar","progress"]},{label:"Product lifecycle",states:["spawning","humming","loading","dictating","writing","sending","receiving","uploading","notifying","alerting","dragging","bouncing","powering-down"]}];XFt.flatMap(n=>n.states);const QFt=new Set(["progress","spawning"]),B0e={progress:2500,spawning:2e3},ezt=1500,rpe={sleeping:[13,22,4],waking:[13],idle:[0,8],listening:[10,1,19],thinking:[8,16,14,17,5],searching:[15,9,3,20,12,18],working:[7,16,11,10],excited:[2,17,21,3,11],surprised:[3,21],suspicious:[14,5,23],angry:[7,16],drowsy:[4,22,13],happy:[2,11,17,19],curious:[