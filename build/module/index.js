/* eslint-disable no-useless-catch */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { deleteDoc, doc, DocumentReference, getDoc, increment, serverTimestamp, setDoc, writeBatch, onSnapshot } from "firebase/firestore";
import { combineLatest, Observable, of } from "rxjs";
import { map, switchMap } from "rxjs/operators";
export async function docExists(ref) {
    return (await getDoc(ref)).exists();
}
export async function setWithCounter(ref, data, setOptions, opts) {
    setOptions = setOptions ? setOptions : {};
    opts = opts ? opts : {};
    opts.dates = opts.dates === undefined
        ? true
        : opts.dates;
    const paths = opts.paths;
    // counter collection
    const counterCol = '_counters';
    const col = ref.path.split('/').slice(0, -1).join('/');
    const countRef = doc(ref.firestore, counterCol, col);
    const refSnap = await getDoc(ref);
    // don't increase count if edit
    try {
        if (refSnap.exists()) {
            if (opts.dates) {
                data = { ...data, updatedAt: serverTimestamp() };
            }
            await setDoc(ref, data, setOptions);
            // increase count
        }
        else {
            // set doc
            const batch = writeBatch(ref.firestore);
            if (opts.dates) {
                data = { ...data, createdAt: serverTimestamp() };
            }
            batch.set(ref, data, setOptions);
            // if other counts
            if (paths) {
                const keys = Object.keys(paths);
                keys.map((k) => {
                    batch.update(doc(ref.firestore, `${k}/${paths[k]}`), {
                        [col + 'Count']: increment(1),
                        ['_' + col + 'Doc']: ref
                    });
                });
            }
            // _counter doc
            batch.set(countRef, {
                count: increment(1),
                _tmpDoc: ref
            }, { merge: true });
            // create counts
            return await batch.commit();
        }
    }
    catch (e) {
        throw e;
    }
}
export async function deleteWithCounter(ref, opts) {
    opts = opts ? opts : {};
    const paths = opts.paths;
    // counter collection
    const counterCol = '_counters';
    const col = ref.path.split('/').slice(0, -1).join('/');
    const countRef = doc(ref.firestore, counterCol, col);
    const batch = writeBatch(ref.firestore);
    try {
        // if other counts
        if (paths) {
            const keys = Object.keys(paths);
            keys.map((k) => {
                batch.update(doc(ref.firestore, `${k}/${paths[k]}`), {
                    [col + 'Count']: increment(-1),
                    ['_' + col + 'Doc']: ref
                });
            });
        }
        // delete doc
        batch.delete(ref);
        batch.set(countRef, {
            count: increment(-1),
            _tmpDoc: ref
        }, { merge: true });
        // edit counts
        return await batch.commit();
    }
    catch (e) {
        throw e;
    }
}
export function expandRef(obs, fields = []) {
    return obs.pipe(switchMap((doc) => doc ? combineLatest((fields.length === 0 ? Object.keys(doc).filter((k) => {
        const p = doc[k] instanceof DocumentReference;
        if (p)
            fields.push(k);
        return p;
    }) : fields).map((f) => docData(doc[f], { idField: 'id' }))).pipe(map((r) => fields.reduce((prev, curr) => ({ ...prev, [curr]: r.shift() }), doc))) : of(doc)));
}
export function expandRefs(obs, fields = []) {
    return obs.pipe(switchMap((col) => col.length !== 0 ? combineLatest(col.map((doc) => (fields.length === 0 ? Object.keys(doc).filter((k) => {
        const p = doc[k] instanceof DocumentReference;
        if (p)
            fields.push(k);
        return p;
    }) : fields).map((f) => docData(doc[f], { idField: 'id' }))).reduce((acc, val) => [].concat(acc, val)))
        .pipe(map((h) => col.map((doc2) => fields.reduce((prev, curr) => ({ ...prev, [curr]: h.shift() }), doc2)))) : of(col)));
}
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
export async function searchIndex({ ref, data, fields, del = false, useSoundex = true, docObj = document, soundexFunc = soundex, copyFields = [] }) {
    const allCol = '_all';
    const searchCol = '_search';
    const termField = '_term';
    const numWords = 6;
    const colId = ref.path.split('/').slice(0, -1).join('/');
    // get collection
    const searchRef = doc(ref.firestore, `${searchCol}/${colId}/${allCol}/${ref.id}`);
    try {
        if (del) {
            await deleteDoc(searchRef);
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
                _data = { ...d, ..._data };
            }
            _data[termField] = m;
            return await setDoc(searchRef, _data);
        }
    }
    catch (e) {
        throw e;
    }
}
export function createIndex(doc, html, n) {
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
export function soundex(s) {
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
// taken from rxFire and simplified
// https://github.com/FirebaseExtended/rxfire/blob/main/firestore/document/index.ts
export function snapToData(snapshot, options = {}) {
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
export function docData(ref, options = {}) {
    return new Observable((subscriber) => onSnapshot(ref, subscriber))
        .pipe(map((snap) => snapToData(snap, options)));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEscUNBQXFDO0FBQ3JDLHVEQUF1RDtBQUN2RCxPQUFPLEVBQ0gsU0FBUyxFQUNULEdBQUcsRUFFSCxpQkFBaUIsRUFDakIsTUFBTSxFQUNOLFNBQVMsRUFDVCxlQUFlLEVBQ2YsTUFBTSxFQUVOLFVBQVUsRUFFVixVQUFVLEVBRWIsTUFBTSxvQkFBb0IsQ0FBQztBQUM1QixPQUFPLEVBQ0gsYUFBYSxFQUNiLFVBQVUsRUFDVixFQUFFLEVBQ0wsTUFBTSxNQUFNLENBQUM7QUFDZCxPQUFPLEVBQ0gsR0FBRyxFQUNILFNBQVMsRUFDWixNQUFNLGdCQUFnQixDQUFDO0FBRXhCLE1BQU0sQ0FBQyxLQUFLLFVBQVUsU0FBUyxDQUFJLEdBQXlCO0lBQ3hELE9BQU8sQ0FBQyxNQUFNLE1BQU0sQ0FBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDO0FBQzNDLENBQUM7QUFFRCxNQUFNLENBQUMsS0FBSyxVQUFVLGNBQWMsQ0FDaEMsR0FBeUIsRUFDekIsSUFBOEIsRUFDOUIsVUFBdUIsRUFDdkIsSUFHQztJQUdELFVBQVUsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQzFDLElBQUksR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3hCLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssS0FBSyxTQUFTO1FBQ2pDLENBQUMsQ0FBQyxJQUFJO1FBQ04sQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUM7SUFFakIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztJQUV6QixxQkFBcUI7SUFDckIsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDO0lBQy9CLE1BQU0sR0FB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VSxPQUFPLENBQUMsQ0FBUztJQUM3QixNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3BDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQVksQ0FBQztJQUM5QixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDWCxNQUFNLEtBQUssR0FBRztRQUNWLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7S0FDQSxDQUFDO0lBQ1QsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO1NBQ0osR0FBRyxDQUFDLENBQUMsQ0FBUyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDNUIsTUFBTSxDQUFDLENBQUMsQ0FBTSxFQUFFLENBQVMsRUFBRSxDQUFRLEVBQUUsRUFBRSxDQUNwQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztTQUM3QyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDZCxPQUFPLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7QUFDakQsQ0FBQztBQUVELG1DQUFtQztBQUNuQyxtRkFBbUY7QUFFbkYsTUFBTSxVQUFVLFVBQVUsQ0FDdEIsUUFBNkIsRUFDN0IsVUFFSSxFQUFFO0lBRU4sTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLElBQUksRUFBUyxDQUFDO0lBQ3BDLG1FQUFtRTtJQUNuRSwrRUFBK0U7SUFDL0UsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLElBQUksSUFBSSxLQUFLLElBQUksRUFBRTtRQUNqRSxPQUFPLElBQUksQ0FBQztLQUNmO0lBQ0QsSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFO1FBQ2pCLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsUUFBUSxDQUFDLEVBQUUsQ0FBQztLQUN2QztJQUNELE9BQU8sSUFBUyxDQUFDO0FBQ3JCLENBQUM7QUFFRCxNQUFNLFVBQVUsT0FBTyxDQUNuQixHQUF5QixFQUN6QixVQUVJLEVBQUU7SUFFTixPQUFPLElBQUksVUFBVSxDQUFzQixDQUFDLFVBQWUsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLEdBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztTQUM5RixJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBTSxDQUFDLENBQUMsQ0FBQztBQUM3RCxDQUFDIn0=