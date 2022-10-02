"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.docData = exports.snapToData = exports.soundex = exports.createIndex = exports.searchIndex = exports.expandRefs = exports.expandRef = exports.deleteWithCounter = exports.setWithCounter = exports.docExists = void 0;
/* eslint-disable no-useless-catch */
/* eslint-disable @typescript-eslint/no-explicit-any */
const firestore_1 = require("firebase/firestore");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
function docExists(ref) {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield (0, firestore_1.getDoc)(ref)).exists();
    });
}
exports.docExists = docExists;
function setWithCounter(ref, data, setOptions, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        setOptions = setOptions ? setOptions : {};
        opts = opts ? opts : {};
        opts.dates = opts.dates === undefined
            ? true
            : opts.dates;
        const paths = opts.paths;
        // counter collection
        const counterCol = '_counters';
        const col = ref.path.split('/').slice(0, -1).join('/');
        const countRef = (0, firestore_1.doc)(ref.firestore, counterCol, col);
        const refSnap = yield (0, firestore_1.getDoc)(ref);
        // don't increase count if edit
        try {
            if (refSnap.exists()) {
                if (opts.dates) {
                    data = Object.assign(Object.assign({}, data), { updatedAt: (0, firestore_1.serverTimestamp)() });
                }
                yield (0, firestore_1.setDoc)(ref, data, setOptions);
                // increase count
            }
            else {
                // set doc
                const batch = (0, firestore_1.writeBatch)(ref.firestore);
                if (opts.dates) {
                    data = Object.assign(Object.assign({}, data), { createdAt: (0, firestore_1.serverTimestamp)() });
                }
                batch.set(ref, data, setOptions);
                // if other counts
                if (paths) {
                    const keys = Object.keys(paths);
                    keys.map((k) => {
                        batch.update((0, firestore_1.doc)(ref.firestore, `${k}/${paths[k]}`), {
                            [col + 'Count']: (0, firestore_1.increment)(1),
                            ['_' + col + 'Doc']: ref
                        });
                    });
                }
                // _counter doc
                batch.set(countRef, {
                    count: (0, firestore_1.increment)(1),
                    _tmpDoc: ref
                }, { merge: true });
                // create counts
                return yield batch.commit();
            }
        }
        catch (e) {
            throw e;
        }
    });
}
exports.setWithCounter = setWithCounter;
function deleteWithCounter(ref, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        opts = opts ? opts : {};
        const paths = opts.paths;
        // counter collection
        const counterCol = '_counters';
        const col = ref.path.split('/').slice(0, -1).join('/');
        const countRef = (0, firestore_1.doc)(ref.firestore, counterCol, col);
        const batch = (0, firestore_1.writeBatch)(ref.firestore);
        try {
            // if other counts
            if (paths) {
                const keys = Object.keys(paths);
                keys.map((k) => {
                    batch.update((0, firestore_1.doc)(ref.firestore, `${k}/${paths[k]}`), {
                        [col + 'Count']: (0, firestore_1.increment)(-1),
                        ['_' + col + 'Doc']: ref
                    });
                });
            }
            // delete doc
            batch.delete(ref);
            batch.set(countRef, {
                count: (0, firestore_1.increment)(-1),
                _tmpDoc: ref
            }, { merge: true });
            // edit counts
            return yield batch.commit();
        }
        catch (e) {
            throw e;
        }
    });
}
exports.deleteWithCounter = deleteWithCounter;
function expandRef(obs, fields = []) {
    return obs.pipe((0, operators_1.switchMap)((doc) => doc ? (0, rxjs_1.combineLatest)((fields.length === 0 ? Object.keys(doc).filter((k) => {
        const p = doc[k] instanceof firestore_1.DocumentReference;
        if (p)
            fields.push(k);
        return p;
    }) : fields).map((f) => docData(doc[f], { idField: 'id' }))).pipe((0, operators_1.map)((r) => fields.reduce((prev, curr) => (Object.assign(Object.assign({}, prev), { [curr]: r.shift() })), doc))) : (0, rxjs_1.of)(doc)));
}
exports.expandRef = expandRef;
function expandRefs(obs, fields = []) {
    return obs.pipe((0, operators_1.switchMap)((col) => col.length !== 0 ? (0, rxjs_1.combineLatest)(col.map((doc) => (fields.length === 0 ? Object.keys(doc).filter((k) => {
        const p = doc[k] instanceof firestore_1.DocumentReference;
        if (p)
            fields.push(k);
        return p;
    }) : fields).map((f) => docData(doc[f], { idField: 'id' }))).reduce((acc, val) => [].concat(acc, val)))
        .pipe((0, operators_1.map)((h) => col.map((doc2) => fields.reduce((prev, curr) => (Object.assign(Object.assign({}, prev), { [curr]: h.shift() })), doc2)))) : (0, rxjs_1.of)(col)));
}
exports.expandRefs = expandRefs;
/**
 *
 * @param param: {
 *  ref - document ref
 *  data - document data
 *  del - boolean - delete past index
 *  useSoundex - index with soundex
 *  docObj - the document object in case of ssr,
 *  soundexFunc - change out soundex function for other languages,
 *  copyFields - field values to copy from original document
 * }
 * @returns
 */
function searchIndex({ ref, data, fields, del = false, useSoundex = true, docObj = document, soundexFunc = soundex, copyFields = [] }) {
    return __awaiter(this, void 0, void 0, function* () {
        const allCol = '_all';
        const searchCol = '_search';
        const termField = '_term';
        const numWords = 6;
        const colId = ref.path.split('/').slice(0, -1).join('/');
        // get collection
        const searchRef = (0, firestore_1.doc)(ref.firestore, `${searchCol}/${colId}/${allCol}/${ref.id}`);
        try {
            if (del) {
                yield (0, firestore_1.deleteDoc)(searchRef);
            }
            else {
                let _data = {};
                const m = {};
                // go through each field to index
                for (const field of fields) {
                    // new indexes
                    let fieldValue = data[field];
                    // if array, turn into string
                    if (Array.isArray(fieldValue)) {
                        fieldValue = fieldValue.join(' ');
                    }
                    let index = createIndex(docObj, fieldValue, numWords);
                    // if filter function, run function on each word
                    if (useSoundex) {
                        const temp = [];
                        for (const i of index) {
                            temp.push(i.split(' ').map((v) => soundexFunc(v)).join(' '));
                        }
                        index = temp;
                        for (const phrase of index) {
                            if (phrase) {
                                let v = '';
                                const t = phrase.split(' ');
                                while (t.length > 0) {
                                    const r = t.shift();
                                    v += v ? ' ' + r : r;
                                    // increment for relevance
                                    m[v] = m[v] ? m[v] + 1 : 1;
                                }
                            }
                        }
                    }
                    else {
                        for (const phrase of index) {
                            if (phrase) {
                                let v = '';
                                for (let i = 0; i < phrase.length; i++) {
                                    v = phrase.slice(0, i + 1).trim();
                                    // increment for relevance
                                    m[v] = m[v] ? m[v] + 1 : 1;
                                }
                            }
                        }
                    }
                }
                if (copyFields.length) {
                    const d = {};
                    for (const [key, value] of Object.entries(copyFields)) {
                        d[key] = value;
                    }
                    _data = Object.assign(Object.assign({}, d), _data);
                }
                _data[termField] = m;
                return yield (0, firestore_1.setDoc)(searchRef, _data);
            }
        }
        catch (e) {
            throw e;
        }
    });
}
exports.searchIndex = searchIndex;
function createIndex(doc, html, n) {
    // create document after text stripped from html
    // get rid of pre code blocks
    const beforeReplace = (text) => {
        return text.replace(/&nbsp;/g, ' ').replace(/<pre[^>]*>([\s\S]*?)<\/pre>/g, '');
    };
    const createDocs = (text) => {
        const finalArray = [];
        const wordArray = text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .replace(/ +/g, ' ')
            .trim()
            .split(' ');
        do {
            finalArray.push(wordArray.slice(0, n).join(' '));
            wordArray.shift();
        } while (wordArray.length !== 0);
        return finalArray;
    };
    // strip text from html
    const extractContent = (html) => {
        if (typeof window === undefined) {
            // can't run on server currently
            return html;
        }
        const tmp = doc.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    };
    // get rid of code first
    return createDocs(extractContent(beforeReplace(html)));
}
exports.createIndex = createIndex;
function soundex(s) {
    const a = s.toLowerCase().split("");
    const f = a.shift();
    let r = "";
    const codes = {
        a: "",
        e: "",
        i: "",
        o: "",
        u: "",
        b: 1,
        f: 1,
        p: 1,
        v: 1,
        c: 2,
        g: 2,
        j: 2,
        k: 2,
        q: 2,
        s: 2,
        x: 2,
        z: 2,
        d: 3,
        t: 3,
        l: 4,
        m: 5,
        n: 5,
        r: 6,
    };
    r = f + a
        .map((v) => codes[v])
        .filter((v, i, b) => i === 0 ? v !== codes[f] : v !== b[i - 1])
        .join("");
    return (r + "000").slice(0, 4).toUpperCase();
}
exports.soundex = soundex;
// taken from rxFire and simplified
// https://github.com/FirebaseExtended/rxfire/blob/main/firestore/document/index.ts
function snapToData(snapshot, options = {}) {
    const data = snapshot.data();
    // match the behavior of the JS SDK when the snapshot doesn't exist
    // it's possible with data converters too that the user didn't return an object
    if (!snapshot.exists() || typeof data !== 'object' || data === null) {
        return data;
    }
    if (options.idField) {
        data[options.idField] = snapshot.id;
    }
    return data;
}
exports.snapToData = snapToData;
function docData(ref, options = {}) {
    return new rxjs_1.Observable((subscriber) => (0, firestore_1.onSnapshot)(ref, subscriber))
        .pipe((0, operators_1.map)((snap) => snapToData(snap, options)));
}
exports.docData = docData;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEscUNBQXFDO0FBQ3JDLHVEQUF1RDtBQUN2RCxrREFjNEI7QUFDNUIsK0JBSWM7QUFDZCw4Q0FHd0I7QUFFeEIsU0FBc0IsU0FBUyxDQUFJLEdBQXlCOztRQUN4RCxPQUFPLENBQUMsTUFBTSxJQUFBLGtCQUFNLEVBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUMzQyxDQUFDO0NBQUE7QUFGRCw4QkFFQztBQUVELFNBQXNCLGNBQWMsQ0FDaEMsR0FBeUIsRUFDekIsSUFBOEIsRUFDOUIsVUFBdUIsRUFDdkIsSUFHQzs7UUFHRCxVQUFVLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUMxQyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN4QixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztZQUNqQyxDQUFDLENBQUMsSUFBSTtZQUNOLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBRWpCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7UUFFekIscUJBQXFCO1FBQ3JCLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQztRQUMvQixNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZELE1BQU0sUUFBUSxHQUFHLElBQUEsZUFBRyxFQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3JELE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBQSxrQkFBTSxFQUFJLEdBQUcsQ0FBQyxDQUFDO1FBRXJDLCtCQUErQjtRQUMvQixJQUFJO1lBQ0EsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQ2xCLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRTtvQkFDWixJQUFJLG1DQUFRLElBQVcsS0FBRSxTQUFTLEVBQUUsSUFBQSwyQkFBZSxHQUFFLEdBQUUsQ0FBQztpQkFDM0Q7Z0JBQ0QsTUFBTSxJQUFBLGtCQUFNLEVBQUksR0FBRyxFQUFFLElBQUksRUFBRSxVQUFVLENBQUMsQ0FBQztnQkFFdkMsaUJBQWlCO2FBQ3BCO2lCQUFNO2dCQUNILFVBQVU7Z0JBQ1YsTUFBTSxLQUFLLEdBQUcsSUFBQSxzQkFBVSxFQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFFeEMsSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFO29CQUNaLElBQUksbUNBQVEsSUFBVyxLQUFFLFNBQVMsRUFBRSxJQUFBLDJCQUFlLEdBQUUsR0FBRSxDQUFDO2lCQUMzRDtnQkFDRCxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7Z0JBRWpDLGtCQUFrQjtnQkFDbEIsSUFBSSxLQUFLLEVBQUU7b0JBQ1AsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFDaEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFO3dCQUNuQixLQUFLLENBQUMsTUFBTSxDQUNSLElBQUEsZUFBRyxFQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFDdEM7NEJBQ0ksQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDLEVBQUUsSUFBQSxxQkFBUyxFQUFDLENBQUMsQ0FBQzs0QkFDN0IsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEtBQUssQ0FBQyxFQUFFLEdBQUc7eUJBQzNCLENBQ0osQ0FBQztvQkFDTixDQUFDLENBQUMsQ0FBQztpQkFDTjtnQkFDRCxlQUFlO2dCQUNmLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFO29CQUNoQixLQUFLLEVBQUUsSUFBQSxxQkFBUyxFQUFDLENBQUMsQ0FBQztvQkFDbkIsT0FBTyxFQUFFLEdBQUc7aUJBQ2YsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUNwQixnQkFBZ0I7Z0JBQ2hCLE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7YUFDL0I7U0FDSjtRQUFDLE9BQU8sQ0FBTSxFQUFFO1lBQ2IsTUFBTSxDQUFDLENBQUM7U0FDWDtJQUNMLENBQUM7Q0FBQTtBQWxFRCx3Q0FrRUM7QUFFRCxTQUFzQixpQkFBaUIsQ0FDbkMsR0FBeUIsRUFDekIsSUFFQzs7UUFHRCxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN4QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBRXpCLHFCQUFxQjtRQUNyQixNQUFNLFVBQVUsR0FBRyxXQUFXLENBQUM7UUFDL0IsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN2RCxNQUFNLFFBQVEsR0FBRyxJQUFBLGVBQUcsRUFBQyxHQUFHLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUNyRCxNQUFNLEtBQUssR0FBRyxJQUFBLHNCQUFVLEVBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3hDLElBQUk7WUFDQSxrQkFBa0I7WUFDbEIsSUFBSSxLQUFLLEVBQUU7Z0JBQ1AsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDaEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFO29CQUNuQixLQUFLLENBQUMsTUFBTSxDQUNSLElBQUEsZUFBRyxFQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFDdEM7d0JBQ0ksQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDLEVBQUUsSUFBQSxxQkFBUyxFQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUM5QixDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxDQUFDLEVBQUUsR0FBRztxQkFDM0IsQ0FDSixDQUFDO2dCQUNOLENBQUMsQ0FBQyxDQUFDO2FBQ047WUFDRCxhQUFhO1lBQ2IsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNsQixLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRTtnQkFDaEIsS0FBSyxFQUFFLElBQUEscUJBQVMsRUFBQyxDQUFDLENBQUMsQ0FBQztnQkFDcEIsT0FBTyxFQUFFLEdBQUc7YUFDZixFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7WUFDcEIsY0FBYztZQUNkLE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7U0FDL0I7UUFBQyxPQUFPLENBQU0sRUFBRTtZQUNiLE1BQU0sQ0FBQyxDQUFDO1NBQ1g7SUFDTCxDQUFDO0NBQUE7QUF4Q0QsOENBd0NDO0FBRUQsU0FBZ0IsU0FBUyxDQUFJLEdBQWtCLEVBQUUsU0FBZ0IsRUFBRTtJQUMvRCxPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQ1gsSUFBQSxxQkFBUyxFQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUEsb0JBQWEsRUFDdkMsQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQzFDLENBQUMsQ0FBTSxFQUFFLEVBQUU7UUFDUCxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLFlBQVksNkJBQWlCLENBQUM7UUFDOUMsSUFBSSxDQUFDO1lBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN0QixPQUFPLENBQUMsQ0FBQztJQUNiLENBQUMsQ0FDSixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUN2RSxDQUFDLElBQUksQ0FDRixJQUFBLGVBQUcsRUFBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FDekIsQ0FBQyxJQUFTLEVBQUUsSUFBUyxFQUFFLEVBQUUsQ0FDckIsaUNBQU0sSUFBSSxLQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxJQUFHLEVBQ2xDLEdBQUcsQ0FBQyxDQUNULENBQ0osQ0FBQyxDQUFDLENBQUMsSUFBQSxTQUFFLEVBQUMsR0FBRyxDQUFDLENBQUMsQ0FDZixDQUFDO0FBQ04sQ0FBQztBQWxCRCw4QkFrQkM7QUFFRCxTQUFnQixVQUFVLENBQUksR0FBb0IsRUFBRSxTQUFnQixFQUFFO0lBQ2xFLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FDWCxJQUFBLHFCQUFTLEVBQUMsQ0FBQyxHQUFVLEVBQUUsRUFBRSxDQUNyQixHQUFHLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBQSxvQkFBYSxFQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFRLEVBQUUsRUFBRSxDQUNsRCxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FDMUMsQ0FBQyxDQUFNLEVBQUUsRUFBRTtRQUNQLE1BQU0sQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsWUFBWSw2QkFBaUIsQ0FBQztRQUM5QyxJQUFJLENBQUM7WUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3RCLE9BQU8sQ0FBQyxDQUFDO0lBQ2IsQ0FBQyxDQUNKLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQ3ZFLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEdBQVEsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQztTQUNqRCxJQUFJLENBQ0QsSUFBQSxlQUFHLEVBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUNYLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFTLEVBQUUsRUFBRSxDQUNsQixNQUFNLENBQUMsTUFBTSxDQUNULENBQUMsSUFBUyxFQUFFLElBQVMsRUFBRSxFQUFFLENBQ3JCLGlDQUFNLElBQUksS0FBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLEVBQUUsSUFBRyxFQUNsQyxJQUFJLENBQ1QsQ0FDSixDQUNKLENBQ0osQ0FBQyxDQUFDLENBQUMsSUFBQSxTQUFFLEVBQUMsR0FBRyxDQUFDLENBQ2xCLENBQ0osQ0FBQztBQUNOLENBQUM7QUF6QkQsZ0NBeUJDO0FBRUQ7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0gsU0FBc0IsV0FBVyxDQUFJLEVBQ2pDLEdBQUcsRUFDSCxJQUFJLEVBQ0osTUFBTSxFQUNOLEdBQUcsR0FBRyxLQUFLLEVBQ1gsVUFBVSxHQUFHLElBQUksRUFDakIsTUFBTSxHQUFHLFFBQVEsRUFDakIsV0FBVyxHQUFHLE9BQU8sRUFDckIsVUFBVSxHQUFHLEVBQUUsRUFVbEI7O1FBRUcsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBQ3RCLE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUM1QixNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUM7UUFDMUIsTUFBTSxRQUFRLEdBQUcsQ0FBQyxDQUFDO1FBRW5CLE1BQU0sS0FBSyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFekQsaUJBQWlCO1FBQ2pCLE1BQU0sU0FBUyxHQUFHLElBQUEsZUFBRyxFQUNqQixHQUFHLENBQUMsU0FBUyxFQUNiLEdBQUcsU0FBUyxJQUFJLEtBQUssSUFBSSxNQUFNLElBQUksR0FBRyxDQUFDLEVBQUUsRUFBRSxDQUM5QyxDQUFDO1FBQ0YsSUFBSTtZQUNBLElBQUksR0FBRyxFQUFFO2dCQUNMLE1BQU0sSUFBQSxxQkFBUyxFQUFDLFNBQVMsQ0FBQyxDQUFDO2FBQzlCO2lCQUFNO2dCQUVILElBQUksS0FBSyxHQUFRLEVBQUUsQ0FBQztnQkFDcEIsTUFBTSxDQUFDLEdBQVEsRUFBRSxDQUFDO2dCQUVsQixpQ0FBaUM7Z0JBQ2pDLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFO29CQUV4QixjQUFjO29CQUNkLElBQUksVUFBVSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFFN0IsNkJBQTZCO29CQUM3QixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUU7d0JBQzNCLFVBQVUsR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO3FCQUNyQztvQkFDRCxJQUFJLEtBQUssR0FBRyxXQUFXLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQztvQkFFdEQsZ0RBQWdEO29CQUNoRCxJQUFJLFVBQVUsRUFBRTt3QkFDWixNQUFNLElBQUksR0FBRyxFQUFFLENBQUM7d0JBQ2hCLEtBQUssTUFBTSxDQUFDLElBQUksS0FBSyxFQUFFOzRCQUNuQixJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUN0QixDQUFDLENBQVMsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUNoQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO3lCQUNoQjt3QkFDRCxLQUFLLEdBQUcsSUFBSSxDQUFDO3dCQUNiLEtBQUssTUFBTSxNQUFNLElBQUksS0FBSyxFQUFFOzRCQUN4QixJQUFJLE1BQU0sRUFBRTtnQ0FDUixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0NBQ1gsTUFBTSxDQUFDLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztnQ0FDNUIsT0FBTyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtvQ0FDakIsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO29DQUNwQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7b0NBQ3JCLDBCQUEwQjtvQ0FDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2lDQUM5Qjs2QkFDSjt5QkFDSjtxQkFDSjt5QkFBTTt3QkFDSCxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssRUFBRTs0QkFDeEIsSUFBSSxNQUFNLEVBQUU7Z0NBQ1IsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dDQUNYLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO29DQUNwQyxDQUFDLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO29DQUNsQywwQkFBMEI7b0NBQzFCLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztpQ0FDOUI7NkJBQ0o7eUJBQ0o7cUJBQ0o7aUJBQ0o7Z0JBQ0QsSUFBSSxVQUFVLENBQUMsTUFBTSxFQUFFO29CQUNuQixNQUFNLENBQUMsR0FBUSxFQUFFLENBQUM7b0JBQ2xCLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFO3dCQUNuRCxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDO3FCQUNsQjtvQkFDRCxLQUFLLG1DQUFRLENBQUMsR0FBSyxLQUFLLENBQUUsQ0FBQztpQkFDOUI7Z0JBQ0QsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDckIsT0FBTyxNQUFNLElBQUEsa0JBQU0sRUFBSSxTQUFnQixFQUFFLEtBQUssQ0FBQyxDQUFDO2FBQ25EO1NBQ0o7UUFBQyxPQUFPLENBQU0sRUFBRTtZQUNiLE1BQU0sQ0FBQyxDQUFDO1NBQ1g7SUFDTCxDQUFDO0NBQUE7QUFuR0Qsa0NBbUdDO0FBRUQsU0FBZ0IsV0FBVyxDQUFDLEdBQWEsRUFBRSxJQUFZLEVBQUUsQ0FBUztJQUM5RCxnREFBZ0Q7SUFDaEQsNkJBQTZCO0lBQzdCLE1BQU0sYUFBYSxHQUFHLENBQUMsSUFBUyxFQUFFLEVBQUU7UUFDaEMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsOEJBQThCLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDcEYsQ0FBQyxDQUFBO0lBQ0QsTUFBTSxVQUFVLEdBQUcsQ0FBQyxJQUFZLEVBQUUsRUFBRTtRQUNoQyxNQUFNLFVBQVUsR0FBYSxFQUFFLENBQUM7UUFDaEMsTUFBTSxTQUFTLEdBQUcsSUFBSTthQUNqQixXQUFXLEVBQUU7YUFDYixPQUFPLENBQUMsa0JBQWtCLEVBQUUsR0FBRyxDQUFDO2FBQ2hDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDO2FBQ25CLElBQUksRUFBRTthQUNOLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNoQixHQUFHO1lBQ0MsVUFBVSxDQUFDLElBQUksQ0FDWCxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQ2xDLENBQUM7WUFDRixTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7U0FDckIsUUFBUSxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtRQUNqQyxPQUFPLFVBQVUsQ0FBQztJQUN0QixDQUFDLENBQUE7SUFDRCx1QkFBdUI7SUFDdkIsTUFBTSxjQUFjLEdBQUcsQ0FBQyxJQUFZLEVBQUUsRUFBRTtRQUNwQyxJQUFJLE9BQU8sTUFBTSxLQUFLLFNBQVMsRUFBRTtZQUM3QixnQ0FBZ0M7WUFDaEMsT0FBTyxJQUFJLENBQUM7U0FDZjtRQUNELE1BQU0sR0FBRyxHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDckMsR0FBRyxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUM7UUFDckIsT0FBTyxHQUFHLENBQUMsV0FBVyxJQUFJLEdBQUcsQ0FBQyxTQUFTLElBQUksRUFBRSxDQUFDO0lBQ2xELENBQUMsQ0FBQTtJQUNELHdCQUF3QjtJQUN4QixPQUFPLFVBQVUsQ0FDYixjQUFjLENBQ1YsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUN0QixDQUNKLENBQUM7QUFDTixDQUFDO0FBdENELGtDQXNDQztBQUVELFNBQWdCLE9BQU8sQ0FBQyxDQUFTO0lBQzdCLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDcEMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBWSxDQUFDO0lBQzlCLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUNYLE1BQU0sS0FBSyxHQUFHO1FBQ1YsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztLQUNBLENBQUM7SUFDVCxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUM7U0FDSixHQUFHLENBQUMsQ0FBQyxDQUFTLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUM1QixNQUFNLENBQUMsQ0FBQyxDQUFNLEVBQUUsQ0FBUyxFQUFFLENBQVEsRUFBRSxFQUFFLENBQ3BDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1NBQzdDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNkLE9BQU8sQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztBQUNqRCxDQUFDO0FBbkNELDBCQW1DQztBQUVELG1DQUFtQztBQUNuQyxtRkFBbUY7QUFFbkYsU0FBZ0IsVUFBVSxDQUN0QixRQUE2QixFQUM3QixVQUVJLEVBQUU7SUFFTixNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsSUFBSSxFQUFTLENBQUM7SUFDcEMsbUVBQW1FO0lBQ25FLCtFQUErRTtJQUMvRSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsSUFBSSxJQUFJLEtBQUssSUFBSSxFQUFFO1FBQ2pFLE9BQU8sSUFBSSxDQUFDO0tBQ2Y7SUFDRCxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUU7UUFDakIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxRQUFRLENBQUMsRUFBRSxDQUFDO0tBQ3ZDO0lBQ0QsT0FBTyxJQUFTLENBQUM7QUFDckIsQ0FBQztBQWhCRCxnQ0FnQkM7QUFFRCxTQUFnQixPQUFPLENBQ25CLEdBQXlCLEVBQ3pCLFVBRUksRUFBRTtJQUVOLE9BQU8sSUFBSSxpQkFBVSxDQUFzQixDQUFDLFVBQWUsRUFBRSxFQUFFLENBQUMsSUFBQSxzQkFBVSxFQUFDLEdBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztTQUM5RixJQUFJLENBQUMsSUFBQSxlQUFHLEVBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFNLENBQUMsQ0FBQyxDQUFDO0FBQzdELENBQUM7QUFSRCwwQkFRQyJ9