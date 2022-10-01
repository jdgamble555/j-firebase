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
function searchIndex(docObj, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        opts.del = opts.del || false;
        opts.useSoundex = opts.useSoundex || true;
        const allCol = '_all';
        const searchCol = '_search';
        const termField = '_term';
        const numWords = 6;
        const colId = opts.ref.path.split('/').slice(0, -1).join('/');
        // get collection
        const searchRef = (0, firestore_1.doc)(opts.ref.firestore, `${searchCol}/${colId}/${allCol}/${opts.ref.id}`);
        try {
            if (opts.del) {
                yield (0, firestore_1.deleteDoc)(searchRef);
            }
            else {
                let data = {};
                const m = {};
                // go through each field to index
                for (const field of opts.fields) {
                    // new indexes
                    let fieldValue = opts.after[field];
                    // if array, turn into string
                    if (Array.isArray(fieldValue)) {
                        fieldValue = fieldValue.join(' ');
                    }
                    let index = createIndex(docObj, fieldValue, numWords);
                    // if filter function, run function on each word
                    if (opts.useSoundex) {
                        const temp = [];
                        for (const i of index) {
                            temp.push(i.split(' ').map((v) => soundex(v)).join(' '));
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
                data[termField] = m;
                data = Object.assign(Object.assign({}, data), { slug: opts.after.slug, title: opts.after.title });
                return yield (0, firestore_1.setDoc)(searchRef, data);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEscUNBQXFDO0FBQ3JDLHVEQUF1RDtBQUN2RCxrREFjNEI7QUFDNUIsK0JBSWM7QUFDZCw4Q0FHd0I7QUFFeEIsU0FBc0IsU0FBUyxDQUFJLEdBQXlCOztRQUN4RCxPQUFPLENBQUMsTUFBTSxJQUFBLGtCQUFNLEVBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUMzQyxDQUFDO0NBQUE7QUFGRCw4QkFFQztBQUVELFNBQXNCLGNBQWMsQ0FDaEMsR0FBeUIsRUFDekIsSUFBOEIsRUFDOUIsVUFBdUIsRUFDdkIsSUFHQzs7UUFHRCxVQUFVLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUMxQyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUN4QixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztZQUNqQyxDQUFDLENBQUMsSUFBSTtZQUNOLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBRWpCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7UUFFekIscUJBQXFCO1FBQ3JCLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQztRQUMvQixNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZELE1BQU0sUUFBUSxHQUFHLElBQUEsZUFBRyxFQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxDQUFD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RUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7S0FDQSxDQUFDO0lBQ1QsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO1NBQ0osR0FBRyxDQUFDLENBQUMsQ0FBUyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDNUIsTUFBTSxDQUFDLENBQUMsQ0FBTSxFQUFFLENBQVMsRUFBRSxDQUFRLEVBQUUsRUFBRSxDQUNwQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztTQUM3QyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDZCxPQUFPLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7QUFDakQsQ0FBQztBQW5DRCwwQkFtQ0M7QUFFRCxtQ0FBbUM7QUFDbkMsbUZBQW1GO0FBRW5GLFNBQWdCLFVBQVUsQ0FDdEIsUUFBNkIsRUFDN0IsVUFFSSxFQUFFO0lBRU4sTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLElBQUksRUFBUyxDQUFDO0lBQ3BDLG1FQUFtRTtJQUNuRSwrRUFBK0U7SUFDL0UsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLElBQUksSUFBSSxLQUFLLElBQUksRUFBRTtRQUNqRSxPQUFPLElBQUksQ0FBQztLQUNmO0lBQ0QsSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFO1FBQ2pCLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsUUFBUSxDQUFDLEVBQUUsQ0FBQztLQUN2QztJQUNELE9BQU8sSUFBUyxDQUFDO0FBQ3JCLENBQUM7QUFoQkQsZ0NBZ0JDO0FBRUQsU0FBZ0IsT0FBTyxDQUNuQixHQUF5QixFQUN6QixVQUVJLEVBQUU7SUFFTixPQUFPLElBQUksaUJBQVUsQ0FBc0IsQ0FBQyxVQUFlLEVBQUUsRUFBRSxDQUFDLElBQUEsc0JBQVUsRUFBQyxHQUFVLEVBQUUsVUFBVSxDQUFDLENBQUM7U0FDOUYsSUFBSSxDQUFDLElBQUEsZUFBRyxFQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBTSxDQUFDLENBQUMsQ0FBQztBQUM3RCxDQUFDO0FBUkQsMEJBUUMifQ==