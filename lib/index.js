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
