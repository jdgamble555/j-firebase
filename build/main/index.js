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
function searchIndex({ ref, data, indexFields, del = false, useSoundex = true, docObj = document, soundexFunc = soundex, copyFields = [], allCol = '_all', searchCol = '_search', termField = '_term', numWords = 6 }) {
    return __awaiter(this, void 0, void 0, function* () {
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
                for (const field of indexFields) {
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
                    for (const k of copyFields) {
                        d[k] = data[k];
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEscUNBQXFDO0FBQ3JDLHVEQUF1RDtBQUN2RCxrREFjNEI7QUFDNUIsK0JBSWM7QUFDZCw4Q0FHd0I7QUFFeEIsU0FBc0IsU0FBUyxDQUFJLEdBQXlCOztRQUN4RCxPQUFPLENBQUMsTUFBTSxJQUFBLGtCQUFNLEVBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUMzQyxDQUFDO0NBQUE7QUFGRCw4QkFFQztBQUVELFNBQXNCLGNBQWMsQ0FDaEMsR0FBeUIsRUFDekIsSUFBOEIsRUFDOUIsVUFBdUIsRUFDdkIsSUFHQzs7UUFHRCxVQUFVLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUMxQyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN4QixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztZQUNqQyxDQUFDLENBQUMsSUFBSTtZQUNOLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBRWpCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7UUFFekIscUJBQXFCO1FBQ3JCLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQztRQUMvQixNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZELE1BQU0sUUFBUSxHQUFHLElBQUEsZUFBRyxFQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3JELE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBQSxrQkFBTSxFQUFJLEdBQUcsQ0FBQyxDQUFDO1FBRXJDLCtCQUErQjtRQUMvQixJQUFJO1lBQ0EsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0JBQ2xCLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRTtvQkFDWixJQUFJLG1DQUFRLElBQVcsS0FBRSxTQUFTLEVBQUUsSUFBQSwyQkFBZSxHQUFFLEdBQUUsQ0FBQztpQkFDM0Q7Z0JBQ0QsTUFBTSxJQUFBLGtCQUFNLEVBQUksR0FBRyxFQUFFLElBQUksRUFBRSxVQUFVLENBQUMsQ0FBQztnQkFFdkMsaUJBQWlCO2FBQ3BCO2lCQUFNO2dCQUNILFVBQVU7Z0JBQ1YsTUFBTSxLQUFLLEdBQUcsSUFBQSxzQkFBVSxFQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFFeEMsSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFO29CQUNaLElBQUksbUNBQVEsSUFBVyxLQUFFLFNBQVMsRUFBRSxJQUFBLDJCQUFlLEdBQUUsR0FBRSxDQUFDO2lCQUMzRDtnQkFDRCxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7Z0JBRWpDLGtCQUFrQjtnQkFDbEIsSUFBSSxLQUFLLEVBQUU7b0JBQ1AsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFDaEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFO3dCQUNuQixLQUFLLENBQUMsTUFBTSxDQUNSLElBQUEsZUFBRyxFQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFDdEM7NEJBQ0ksQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDLEVBQUUsSUFBQSxxQkFBUyxFQUFDLENBQUMsQ0FBQzs0QkFDN0IsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLEtBQUssQ0FBQyxFQUFFLEdBQUc7eUJBQzNCLENBQ0osQ0FBQztvQkFDTixDQUFDLENBQUMsQ0FBQztpQkFDTjtnQkFDRCxlQUFlO2dCQUNmLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFO29CQUNoQixLQUFLLEVBQUUsSUFBQSxxQkFBUyxFQUFDLENBQUMsQ0FBQztvQkFDbkIsT0FBTyxFQUFFLEdBQUc7aUJBQ2YsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUNwQixnQkFBZ0I7Z0JBQ2hCLE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7YUFDL0I7U0FDSjtRQUFDLE9BQU8sQ0FBTSxFQUFFO1lBQ2IsTUFBTSxDQUFDLENBQUM7U0FDWDtJQUNMLENBQUM7Q0FBQTtBQWxFRCx3Q0FrRUM7QUFFRCxTQUFzQixpQkFBaUIsQ0FDbkMsR0FBeUIsRUFDekIsSUFFQzs7UUFHRCxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN4QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBRXpCLHFCQUFxQjtRQUNyQixNQUFNLFVBQVUsR0FBRyxXQUFXLENBQUM7UUFDL0IsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN2RCxNQUFNLFFBQVEsR0FBRyxJQUFBLGVBQUcsRUFBQyxHQUFHLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUNyRCxNQUFNLEtBQUssR0FBRyxJQUFBLHNCQUFVLEVBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ3hDLElBQUk7WUFDQSxrQkFBa0I7WUFDbEIsSUFBSSxLQUFLLEVBQUU7Z0JBQ1AsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDaEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFO29CQUNuQixLQUFLLENBQUMsTUFBTSxDQUNSLElBQUEsZUFBRyxFQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFDdEM7d0JBQ0ksQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDLEVBQUUsSUFBQSxxQkFBUyxFQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUM5QixDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxDQUFDLEVBQUUsR0FBRztxQkFDM0IsQ0FDSixDQUFDO2dCQUNOLENBQUMsQ0FBQyxDQUFDO2FBQ047WUFDRCxhQUFhO1lBQ2IsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNsQixLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRTtnQkFDaEIsS0FBSyxFQUFFLElBQUEscUJBQVMsRUFBQyxDQUFDLENBQUMsQ0FBQztnQkFDcEIsT0FBTyxFQUFFLEdBQUc7YUFDZixFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7WUFDcEIsY0FBYztZQUNkLE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7U0FDL0I7UUFBQyxPQUFPLENBQU0sRUFBRTtZQUNiLE1BQU0sQ0FBQyxDQUFDO1NBQ1g7SUFDTCxDQUFDO0NBQUE7QUF4Q0QsOENBd0NDO0FBRUQsU0FBZ0IsU0FBUyxDQUFJLEdBQWtCLEVBQUUsU0FBZ0IsRUFBRTtJQUMvRCxPQUFPLEdBQUcsQ0FBQyxJQUFJLENBQ1gsSUFBQSxxQkFBUyxFQUFDLENBQUMsR0FBUSxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUEsb0JBQWEsRUFDdkMsQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQzFDLENBQUMsQ0FBTSxFQUFFLEVBQUU7UUFDUCxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLFlBQVksNkJBQWlCLENBQUM7UUFDOUMsSUFBSSxDQUFDO1lBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN0QixPQUFPLENBQUMsQ0FBQztJQUNiLENBQUMsQ0FDSixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUN2RSxDQUFDLElBQUksQ0FDRixJQUFBLGVBQUcsRUFBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FDekIsQ0FBQyxJQUFTLEVBQUUsSUFBUyxFQUFFLEVBQUUsQ0FDckIsaUNBQU0sSUFBSSxLQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxJQUFHLEVBQ2xDLEdBQUcsQ0FBQyxDQUNULENBQ0osQ0FBQyxDQUFDLENBQUMsSUFBQSxTQUFFLEVBQUMsR0FBRyxDQUFDLENBQUMsQ0FDZixDQUFDO0FBQ04sQ0FBQztBQWxCRCw4QkFrQkM7QUFFRCxTQUFnQixVQUFVLENBQUksR0FBb0IsRUFBRSxTQUFnQixFQUFFO0lBQ2xFLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FDWCxJQUFBLHFCQUFTLEVBQUMsQ0FBQyxHQUFVLEVBQUUsRUFBRSxDQUNyQixHQUFHLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBQSxvQkFBYSxFQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFRLEVBQUUsRUFBRSxDQUNsRCxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FDMUMsQ0FBQyxDQUFNLEVBQUUsRUFBRTtRQUNQLE1BQU0sQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsWUFBWSw2QkFBaUIsQ0FBQztRQUM5QyxJQUFJLENBQUM7WUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3RCLE9BQU8sQ0FBQyxDQUFDO0lBQ2IsQ0FBQyxDQUNKLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQ3ZFLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBUSxFQUFFLEdBQVEsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQztTQUNqRCxJQUFJLENBQ0QsSUFBQSxlQUFHLEVBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUNYLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFTLEVBQUUsRUFBRSxDQUNsQixNQUFNLENBQUMsTUFBTSxDQUNULENBQUMsSUFBUyxFQUFFLElBQVMsRUFBRSxFQUFFLENBQ3JCLGlDQUFNLElBQUksS0FBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLEVBQUUsSUFBRyxFQUNsQyxJQUFJLENBQ1QsQ0FDSixDQUNKLENBQ0osQ0FBQyxDQUFDLENBQUMsSUFBQSxTQUFFLEVBQUMsR0FBRyxDQUFDLENBQ2xCLENBQ0osQ0FBQztBQUNOLENBQUM7QUF6QkQsZ0NBeUJDO0FBRUQ7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0gsU0FBc0IsV0FBVyxDQUFJLEVBQ2pDLEdBQUcsRUFDSCxJQUFJLEVBQ0osV0FBVyxFQUNYLEdBQUcsR0FBRyxLQUFLLEVBQ1gsVUFBVSxHQUFHLElBQUksRUFDakIsTUFBTSxHQUFHLFFBQVEsRUFDakIsV0FBVyxHQUFHLE9BQU8sRUFDckIsVUFBVSxHQUFHLEVBQUUsRUFDZixNQUFNLEdBQUcsTUFBTSxFQUNmLFNBQVMsR0FBRyxTQUFTLEVBQ3JCLFNBQVMsR0FBRyxPQUFPLEVBQ25CLFFBQVEsR0FBRyxDQUFDLEVBY2Y7O1FBRUcsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUV6RCxpQkFBaUI7UUFDakIsTUFBTSxTQUFTLEdBQUcsSUFBQSxlQUFHLEVBQ2pCLEdBQUcsQ0FBQyxTQUFTLEVBQ2IsR0FBRyxTQUFTLElBQUksS0FBSyxJQUFJLE1BQU0sSUFBSSxHQUFHLENBQUMsRUFBRSxFQUFFLENBQzlDLENBQUM7UUFDRixJQUFJO1lBQ0EsSUFBSSxHQUFHLEVBQUU7Z0JBQ0wsTUFBTSxJQUFBLHFCQUFTLEVBQUMsU0FBUyxDQUFDLENBQUM7YUFDOUI7aUJBQU07Z0JBRUgsSUFBSSxLQUFLLEdBQVEsRUFBRSxDQUFDO2dCQUNwQixNQUFNLENBQUMsR0FBUSxFQUFFLENBQUM7Z0JBRWxCLGlDQUFpQztnQkFDakMsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLEVBQUU7b0JBRTdCLGNBQWM7b0JBQ2QsSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO29CQUU3Qiw2QkFBNkI7b0JBQzdCLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRTt3QkFDM0IsVUFBVSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7cUJBQ3JDO29CQUNELElBQUksS0FBSyxHQUFHLFdBQVcsQ0FBQyxNQUFNLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFDO29CQUV0RCxnREFBZ0Q7b0JBQ2hELElBQUksVUFBVSxFQUFFO3dCQUNaLE1BQU0sSUFBSSxHQUFHLEVBQUUsQ0FBQzt3QkFDaEIsS0FBSyxNQUFNLENBQUMsSUFBSSxLQUFLLEVBQUU7NEJBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQ3RCLENBQUMsQ0FBUyxFQUFFLEVBQUUsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQ2hDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7eUJBQ2hCO3dCQUNELEtBQUssR0FBRyxJQUFJLENBQUM7d0JBQ2IsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLEVBQUU7NEJBQ3hCLElBQUksTUFBTSxFQUFFO2dDQUNSLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztnQ0FDWCxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dDQUM1QixPQUFPLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO29DQUNqQixNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUM7b0NBQ3BCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQ0FDckIsMEJBQTBCO29DQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7aUNBQzlCOzZCQUNKO3lCQUNKO3FCQUNKO3lCQUFNO3dCQUNILEtBQUssTUFBTSxNQUFNLElBQUksS0FBSyxFQUFFOzRCQUN4QixJQUFJLE1BQU0sRUFBRTtnQ0FDUixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0NBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7b0NBQ3BDLENBQUMsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7b0NBQ2xDLDBCQUEwQjtvQ0FDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2lDQUM5Qjs2QkFDSjt5QkFDSjtxQkFDSjtpQkFDSjtnQkFDRCxJQUFJLFVBQVUsQ0FBQyxNQUFNLEVBQUU7b0JBQ25CLE1BQU0sQ0FBQyxHQUFRLEVBQUUsQ0FBQztvQkFDbEIsS0FBSyxNQUFNLENBQUMsSUFBSSxVQUFVLEVBQUU7d0JBQ3hCLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7cUJBQ2xCO29CQUNELEtBQUssbUNBQVEsQ0FBQyxHQUFLLEtBQUssQ0FBRSxDQUFDO2lCQUM5QjtnQkFDRCxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNyQixPQUFPLE1BQU0sSUFBQSxrQkFBTSxFQUFJLFNBQWdCLEVBQUUsS0FBSyxDQUFDLENBQUM7YUFDbkQ7U0FDSjtRQUFDLE9BQU8sQ0FBTSxFQUFFO1lBQ2IsTUFBTSxDQUFDLENBQUM7U0FDWDtJQUNMLENBQUM7Q0FBQTtBQXRHRCxrQ0FzR0M7QUFFRCxTQUFnQixXQUFXLENBQUMsR0FBYSxFQUFFLElBQVksRUFBRSxDQUFTO0lBQzlELGdEQUFnRDtJQUNoRCw2QkFBNkI7SUFDN0IsTUFBTSxhQUFhLEdBQUcsQ0FBQyxJQUFTLEVBQUUsRUFBRTtRQUNoQyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUNwRixDQUFDLENBQUE7SUFDRCxNQUFNLFVBQVUsR0FBRyxDQUFDLElBQVksRUFBRSxFQUFFO1FBQ2hDLE1BQU0sVUFBVSxHQUFhLEVBQUUsQ0FBQztRQUNoQyxNQUFNLFNBQVMsR0FBRyxJQUFJO2FBQ2pCLFdBQVcsRUFBRTthQUNiLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxHQUFHLENBQUM7YUFDaEMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUM7YUFDbkIsSUFBSSxFQUFFO2FBQ04sS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2hCLEdBQUc7WUFDQyxVQUFVLENBQUMsSUFBSSxDQUNYLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FDbEMsQ0FBQztZQUNGLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUNyQixRQUFRLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1FBQ2pDLE9BQU8sVUFBVSxDQUFDO0lBQ3RCLENBQUMsQ0FBQTtJQUNELHVCQUF1QjtJQUN2QixNQUFNLGNBQWMsR0FBRyxDQUFDLElBQVksRUFBRSxFQUFFO1FBQ3BDLElBQUksT0FBTyxNQUFNLEtBQUssU0FBUyxFQUFFO1lBQzdCLGdDQUFnQztZQUNoQyxPQUFPLElBQUksQ0FBQztTQUNmO1FBQ0QsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNyQyxHQUFHLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQztRQUNyQixPQUFPLEdBQUcsQ0FBQyxXQUFXLElBQUksR0FBRyxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUM7SUFDbEQsQ0FBQyxDQUFBO0lBQ0Qsd0JBQXdCO0lBQ3hCLE9BQU8sVUFBVSxDQUNiLGNBQWMsQ0FDVixhQUFhLENBQUMsSUFBSSxDQUFDLENBQ3RCLENBQ0osQ0FBQztBQUNOLENBQUM7QUF0Q0Qsa0NBc0NDO0FBRUQsU0FBZ0IsT0FBTyxDQUFDLENBQVM7SUFDN0IsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNwQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFZLENBQUM7SUFDOUIsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQ1gsTUFBTSxLQUFLLEdBQUc7UUFDVixDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO0tBQ0EsQ0FBQztJQUNULENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztTQUNKLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQzVCLE1BQU0sQ0FBQyxDQUFDLENBQU0sRUFBRSxDQUFTLEVBQUUsQ0FBUSxFQUFFLEVBQUUsQ0FDcEMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7U0FDN0MsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ2QsT0FBTyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBQ2pELENBQUM7QUFuQ0QsMEJBbUNDO0FBRUQsbUNBQW1DO0FBQ25DLG1GQUFtRjtBQUVuRixTQUFnQixVQUFVLENBQ3RCLFFBQTZCLEVBQzdCLFVBRUksRUFBRTtJQUVOLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLEVBQVMsQ0FBQztJQUNwQyxtRUFBbUU7SUFDbkUsK0VBQStFO0lBQy9FLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxJQUFJLElBQUksS0FBSyxJQUFJLEVBQUU7UUFDakUsT0FBTyxJQUFJLENBQUM7S0FDZjtJQUNELElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRTtRQUNqQixJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLFFBQVEsQ0FBQyxFQUFFLENBQUM7S0FDdkM7SUFDRCxPQUFPLElBQVMsQ0FBQztBQUNyQixDQUFDO0FBaEJELGdDQWdCQztBQUVELFNBQWdCLE9BQU8sQ0FDbkIsR0FBeUIsRUFDekIsVUFFSSxFQUFFO0lBRU4sT0FBTyxJQUFJLGlCQUFVLENBQXNCLENBQUMsVUFBZSxFQUFFLEVBQUUsQ0FBQyxJQUFBLHNCQUFVLEVBQUMsR0FBVSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1NBQzlGLElBQUksQ0FBQyxJQUFBLGVBQUcsRUFBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxPQUFPLENBQU0sQ0FBQyxDQUFDLENBQUM7QUFDN0QsQ0FBQztBQVJELDBCQVFDIn0=