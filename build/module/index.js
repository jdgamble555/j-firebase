/* eslint-disable no-useless-catch */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { deleteDoc, doc, DocumentReference, getDoc, increment, serverTimestamp, setDoc, writeBatch, onSnapshot, collection, getDocs, orderBy, query } from "firebase/firestore";
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
 *  searchCol - the collection to store search index
 *  allCol - the search sub collection to store index docs
 *  termField - the document field to store index
 *  numWords - the number of words to index in a phrase
 * }
 * @returns
 */
export async function searchIndex({ ref, data, indexFields, del = false, useSoundex = true, docObj = document, soundexFunc = soundex, copyFields = [], allCol = '_all', searchCol = '_search', termField = '_term', numWords = 6 }) {
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
/**
 * @param collectionRef - the collection reference
 * @param term - the phrase you're searching
 * @param param: {
 *   searchCol - the search collection indexed
 *   allCol - the sub search collection indexed
 *   idField - the name of the id field to return
 *   termField - the term field that is indexed
 *   soundexFunc - the soundex function to use
 *   filters = other query constraints to add (where, startAt, etc)
 * }
 * @returns search document references
 */
export async function searchDocs(collectionRef, term, { searchCol = '_search', allCol = '_all', idField = 'id', termField = '_term', soundexFunc = soundex, filters = [] } = {}) {
    // split term from soundex
    term = term.split(' ')
        .map(v => soundexFunc(v)).join(' ');
    try {
        // get 
        return await getDocs(query(collection(collectionRef.firestore, `${searchCol}/${collectionRef.path}/${allCol}`), orderBy(termField + term), ...filters)).then((arr) => {
            if (!arr.empty) {
                return arr.map((snap) => snapToData(snap, { idField }));
            }
            return null;
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEscUNBQXFDO0FBQ3JDLHVEQUF1RDtBQUN2RCxPQUFPLEVBQ0gsU0FBUyxFQUNULEdBQUcsRUFFSCxpQkFBaUIsRUFDakIsTUFBTSxFQUNOLFNBQVMsRUFDVCxlQUFlLEVBQ2YsTUFBTSxFQUVOLFVBQVUsRUFFVixVQUFVLEVBRVYsVUFBVSxFQUVWLE9BQU8sRUFDUCxPQUFPLEVBQ1AsS0FBSyxFQUNSLE1BQU0sb0JBQW9CLENBQUM7QUFDNUIsT0FBTyxFQUNILGFBQWEsRUFDYixVQUFVLEVBQ1YsRUFBRSxFQUNMLE1BQU0sTUFBTSxDQUFDO0FBQ2QsT0FBTyxFQUNILEdBQUcsRUFDSCxTQUFTLEVBQ1osTUFBTSxnQkFBZ0IsQ0FBQztBQUV4QixNQUFNLENBQUMsS0FBSyxVQUFVLFNBQVMsQ0FBSSxHQUF5QjtJQUN4RCxPQUFPLENBQUMsTUFBTSxNQUFNLENBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztBQUMzQyxDQUFDO0FBRUQsTUFBTSxDQUFDLEtBQUssVUFBVSxjQUFjLENBQ2hDLEdBQXlCLEVBQ3pCLElBQThCLEVBQzlCLFVBQXVCLEVBQ3ZCLElBR0M7SUFHRCxVQUFVLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUMxQyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUN4QixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztRQUNqQyxDQUFDLENBQUMsSUFBSTtRQUNOLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBRWpCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7SUFFekIscUJBQXFCO0lBQ3JCLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQztJQUMvQixNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3ZELE1BQU0sUUFBUSxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNyRCxNQUFNLE9BQU8sR0FBRyxNQUFNLE1BQU0sQ0FBSSxHQUFHLENBQUMsQ0FBQztJQUVyQywrQkFBK0I7SUFDL0IsSUFBSTtRQUNBLElBQUksT0FBTyxDQUFDLE1BQU0sRUFBRSxFQUFFO1lBQ2xCLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRTtnQkFDWixJQUFJLEdBQUcsRUFBRSxHQUFHLElBQVcsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUFFLEVBQUUsQ0FBQzthQUMzRDtZQUNELE1BQU0sTUFBTSxDQUFJLEdBQUcsRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFFdkMsaUJBQWlCO1NBQ3BCO2FBQU07WUFDSCxVQUFVO1lBQ1YsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUV4QyxJQUFJLElBQUksQ0FBQyxLQUFLLEVBQUU7Z0JBQ1osSUFBSSxHQUFHLEVBQUUsR0FBRyxJQUFXLEVBQUUsU0FBUyxFQUFFLGVBQWUsRUFBRSxFQUFFLENBQUM7YUFDM0Q7WUFDRCxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFFakMsa0JBQWtCO1lBQ2xCLElBQUksS0FBSyxFQUFFO2dCQUNQLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ2hDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFTLEVBQUUsRUFBRTtvQkFDbkIsS0FBSyxDQUFDLE1BQU0sQ0FDUixHQUFHLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUN0Qzt3QkFDSSxDQUFDLEdBQUcsR0FBRyxPQUFPLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDO3dCQUM3QixDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxDQUFDLEVBQUUsR0FBRztxQkFDM0IsQ0FDSixDQUFDO2dCQUNOLENBQUMsQ0FBQyxDQUFDO2FBQ047WUFDRCxlQUFlO1lBQ2YsS0FBSyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUU7Z0JBQ2hCLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDO2dCQUNuQixPQUFPLEVBQUUsR0FBRzthQUNmLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNwQixnQkFBZ0I7WUFDaEIsT0FBTyxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztTQUMvQjtLQUNKO0lBQUMsT0FBTyxDQUFNLEVBQUU7UUFDYixNQUFNLENBQUMsQ0FBQztLQUNYO0FBQ0wsQ0FBQztBQUVELE1BQU0sQ0FBQyxLQUFLLFVBQVUsaUJBQWlCLENBQ25DLEdBQXlCLEVBQ3pCLElBRUM7SUFHRCxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUN4QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBRXpCLHFCQUFxQjtJQUNyQixNQUFNLFVBQVUsR0FBRyxXQUFXLENBQUM7SUFDL0IsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUN2RCxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsR0FBRyxDQUFDLENBQUM7SUFDckQsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN4QyxJQUFJO1FBQ0Esa0JBQWtCO1FBQ2xCLElBQUksS0FBSyxFQUFFO1lBQ1AsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNoQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBUyxFQUFFLEVBQUU7Z0JBQ25CLEtBQUssQ0FBQyxNQUFNLENBQ1IsR0FBRyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFDdEM7b0JBQ0ksQ0FBQyxHQUFHLEdBQUcsT0FBTyxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUM5QixDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsS0FBSyxDQUFDLEVBQUUsR0FBRztpQkFDM0IsQ0FDSixDQUFDO1lBQ04sQ0FBQyxDQUFDLENBQUM7U0FDTjtRQUNELGFBQWE7UUFDYixLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2xCLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFO1lBQ2hCLEtBQUssRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDcEIsT0FBTyxFQUFFLEdBQUc7U0FDZixFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDcEIsY0FBYztRQUNkLE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7S0FDL0I7SUFBQyxPQUFPLENBQU0sRUFBRTtRQUNiLE1BQU0sQ0FBQyxDQUFDO0tBQ1g7QUFDTCxDQUFDO0FBRUQsTUFBTSxVQUFVLFNBQVMsQ0FBSSxHQUFrQixFQUFFLFNBQWdCLEVBQUU7SUFDL0QsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUNYLFNBQVMsQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQ3ZDLENBQUMsTUFBTSxDQUFDLE1BQU0sS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUMxQyxDQUFDLENBQU0sRUFBRSxFQUFFO1FBQ1AsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxZQUFZLGlCQUFpQixDQUFDO1FBQzlDLElBQUksQ0FBQztZQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdEIsT0FBTyxDQUFDLENBQUM7SUFDYixDQUFDLENBQ0osQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FDdkUsQ0FBQyxJQUFJLENBQ0YsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUN6QixDQUFDLElBQVMsRUFBRSxJQUFTLEVBQUUsRUFBRSxDQUNyQixDQUFDLEVBQUUsR0FBRyxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxFQUNsQyxHQUFHLENBQUMsQ0FDVCxDQUNKLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUNmLENBQUM7QUFDTixDQUFDO0FBRUQsTUFBTSxVQUFVLFVBQVUsQ0FBSSxHQUFvQixFQUFFLFNBQWdCLEVBQUU7SUFDbEUsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUNYLFNBQVMsQ0FBQyxDQUFDLEdBQVUsRUFBRSxFQUFFLENBQ3JCLEdBQUcsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFLENBQ2xELENBQUMsTUFBTSxDQUFDLE1BQU0sS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUMxQyxDQUFDLENBQU0sRUFBRSxFQUFFO1FBQ1AsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxZQUFZLGlCQUFpQixDQUFDO1FBQzlDLElBQUksQ0FBQztZQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdEIsT0FBTyxDQUFDLENBQUM7SUFDYixDQUFDLENBQ0osQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FDdkUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFRLEVBQUUsR0FBUSxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1NBQ2pELElBQUksQ0FDRCxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUNYLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFTLEVBQUUsRUFBRSxDQUNsQixNQUFNLENBQUMsTUFBTSxDQUNULENBQUMsSUFBUyxFQUFFLElBQVMsRUFBRSxFQUFFLENBQ3JCLENBQUMsRUFBRSxHQUFHLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEVBQ2xDLElBQUksQ0FDVCxDQUNKLENBQ0osQ0FDSixDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQ2xCLENBQ0osQ0FBQztBQUNOLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsV0FBVyxDQUFJLEVBQ2pDLEdBQUcsRUFDSCxJQUFJLEVBQ0osV0FBVyxFQUNYLEdBQUcsR0FBRyxLQUFLLEVBQ1gsVUFBVSxHQUFHLElBQUksRUFDakIsTUFBTSxHQUFHLFFBQVEsRUFDakIsV0FBVyxHQUFHLE9BQU8sRUFDckIsVUFBVSxHQUFHLEVBQUUsRUFDZixNQUFNLEdBQUcsTUFBTSxFQUNmLFNBQVMsR0FBRyxTQUFTLEVBQ3JCLFNBQVMsR0FBRyxPQUFPLEVBQ25CLFFBQVEsR0FBRyxDQUFDLEVBY2Y7SUFFRyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRXpELGlCQUFpQjtJQUNqQixNQUFNLFNBQVMsR0FBRyxHQUFHLENBQ2pCLEdBQUcsQ0FBQyxTQUFTLEVBQ2IsR0FBRyxTQUFTLElBQUksS0FBSyxJQUFJLE1BQU0sSUFBSSxHQUFHLENBQUMsRUFBRSxFQUFFLENBQzlDLENBQUM7SUFDRixJQUFJO1FBQ0EsSUFBSSxHQUFHLEVBQUU7WUFDTCxNQUFNLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQztTQUM5QjthQUFNO1lBRUgsSUFBSSxLQUFLLEdBQVEsRUFBRSxDQUFDO1lBQ3BCLE1BQU0sQ0FBQyxHQUFRLEVBQUUsQ0FBQztZQUVsQixpQ0FBaUM7WUFDakMsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLEVBQUU7Z0JBRTdCLGNBQWM7Z0JBQ2QsSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUU3Qiw2QkFBNkI7Z0JBQzdCLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRTtvQkFDM0IsVUFBVSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7aUJBQ3JDO2dCQUNELElBQUksS0FBSyxHQUFHLFdBQVcsQ0FBQyxNQUFNLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFDO2dCQUV0RCxnREFBZ0Q7Z0JBQ2hELElBQUksVUFBVSxFQUFFO29CQUNaLE1BQU0sSUFBSSxHQUFHLEVBQUUsQ0FBQztvQkFDaEIsS0FBSyxNQUFNLENBQUMsSUFBSSxLQUFLLEVBQUU7d0JBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQ3RCLENBQUMsQ0FBUyxFQUFFLEVBQUUsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQ2hDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7cUJBQ2hCO29CQUNELEtBQUssR0FBRyxJQUFJLENBQUM7b0JBQ2IsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLEVBQUU7d0JBQ3hCLElBQUksTUFBTSxFQUFFOzRCQUNSLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQzs0QkFDWCxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDOzRCQUM1QixPQUFPLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dDQUNqQixNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUM7Z0NBQ3BCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQ0FDckIsMEJBQTBCO2dDQUMxQixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7NkJBQzlCO3lCQUNKO3FCQUNKO2lCQUNKO3FCQUFNO29CQUNILEtBQUssTUFBTSxNQUFNLElBQUksS0FBSyxFQUFFO3dCQUN4QixJQUFJLE1BQU0sRUFBRTs0QkFDUixJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7NEJBQ1gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7Z0NBQ3BDLENBQUMsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7Z0NBQ2xDLDBCQUEwQjtnQ0FDMUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDOzZCQUM5Qjt5QkFDSjtxQkFDSjtpQkFDSjthQUNKO1lBQ0QsSUFBSSxVQUFVLENBQUMsTUFBTSxFQUFFO2dCQUNuQixNQUFNLENBQUMsR0FBUSxFQUFFLENBQUM7Z0JBQ2xCLEtBQUssTUFBTSxDQUFDLElBQUksVUFBVSxFQUFFO29CQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2lCQUNsQjtnQkFDRCxLQUFLLEdBQUcsRUFBRSxHQUFHLENBQUMsRUFBRSxHQUFHLEtBQUssRUFBRSxDQUFDO2FBQzlCO1lBQ0QsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNyQixPQUFPLE1BQU0sTUFBTSxDQUFJLFNBQWdCLEVBQUUsS0FBSyxDQUFDLENBQUM7U0FDbkQ7S0FDSjtJQUFDLE9BQU8sQ0FBTSxFQUFFO1FBQ2IsTUFBTSxDQUFDLENBQUM7S0FDWDtBQUNMLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLFVBQVUsQ0FDNUIsYUFBcUMsRUFDckMsSUFBWSxFQUNaLEVBQ0ksU0FBUyxHQUFHLFNBQVMsRUFDckIsTUFBTSxHQUFHLE1BQU0sRUFDZixPQUFPLEdBQUcsSUFBSSxFQUNkLFNBQVMsR0FBRyxPQUFPLEVBQ25CLFdBQVcsR0FBRyxPQUFPLEVBQ3JCLE9BQU8sR0FBRyxFQUFFLEVBQ2YsR0FBRyxFQUFFO0lBRU4sMEJBQTBCO0lBQzFCLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQztTQUNqQixHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQ3ZCLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2hCLElBQUk7UUFFQSxPQUFPO1FBQ1AsT0FBTyxNQUFNLE9BQU8sQ0FDaEIsS0FBSyxDQUNELFVBQVUsQ0FDTixhQUFhLENBQUMsU0FBUyxFQUN2QixHQUFHLFNBQVMsSUFBSSxhQUFhLENBQUMsSUFBSSxJQUFJLE1BQU0sRUFBRSxDQUMxQyxFQUNSLE9BQU8sQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLEVBQ3pCLEdBQUcsT0FBTyxDQUNiLENBQ0osQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFRLEVBQUUsRUFBRTtZQUNoQixJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRTtnQkFDWixPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFTLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsQ0FBTSxDQUFDLENBQUM7YUFDckU7WUFDRCxPQUFPLElBQUksQ0FBQztRQUNoQixDQUFDLENBQUMsQ0FBQztLQUNOO0lBQUMsT0FBTyxDQUFNLEVBQUU7UUFDYixNQUFNLENBQUMsQ0FBQztLQUNYO0FBQ0wsQ0FBQztBQUVELE1BQU0sVUFBVSxXQUFXLENBQUMsR0FBYSxFQUFFLElBQVksRUFBRSxDQUFTO0lBQzlELGdEQUFnRDtJQUNoRCw2QkFBNkI7SUFDN0IsTUFBTSxhQUFhLEdBQUcsQ0FBQyxJQUFTLEVBQUUsRUFBRTtRQUNoQyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUNwRixDQUFDLENBQUE7SUFDRCxNQUFNLFVBQVUsR0FBRyxDQUFDLElBQVksRUFBRSxFQUFFO1FBQ2hDLE1BQU0sVUFBVSxHQUFhLEVBQUUsQ0FBQztRQUNoQyxNQUFNLFNBQVMsR0FBRyxJQUFJO2FBQ2pCLFdBQVcsRUFBRTthQUNiLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxHQUFHLENBQUM7YUFDaEMsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUM7YUFDbkIsSUFBSSxFQUFFO2FBQ04sS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2hCLEdBQUc7WUFDQyxVQUFVLENBQUMsSUFBSSxDQUNYLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FDbEMsQ0FBQztZQUNGLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUNyQixRQUFRLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1FBQ2pDLE9BQU8sVUFBVSxDQUFDO0lBQ3RCLENBQUMsQ0FBQTtJQUNELHVCQUF1QjtJQUN2QixNQUFNLGNBQWMsR0FBRyxDQUFDLElBQVksRUFBRSxFQUFFO1FBQ3BDLElBQUksT0FBTyxNQUFNLEtBQUssU0FBUyxFQUFFO1lBQzdCLGdDQUFnQztZQUNoQyxPQUFPLElBQUksQ0FBQztTQUNmO1FBQ0QsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNyQyxHQUFHLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQztRQUNyQixPQUFPLEdBQUcsQ0FBQyxXQUFXLElBQUksR0FBRyxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUM7SUFDbEQsQ0FBQyxDQUFBO0lBQ0Qsd0JBQXdCO0lBQ3hCLE9BQU8sVUFBVSxDQUNiLGNBQWMsQ0FDVixhQUFhLENBQUMsSUFBSSxDQUFDLENBQ3RCLENBQ0osQ0FBQztBQUNOLENBQUM7QUFFRCxNQUFNLFVBQVUsT0FBTyxDQUFDLENBQVM7SUFDN0IsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNwQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFZLENBQUM7SUFDOUIsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQ1gsTUFBTSxLQUFLLEdBQUc7UUFDVixDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLEVBQUU7UUFDTCxDQUFDLEVBQUUsRUFBRTtRQUNMLENBQUMsRUFBRSxFQUFFO1FBQ0wsQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO1FBQ0osQ0FBQyxFQUFFLENBQUM7UUFDSixDQUFDLEVBQUUsQ0FBQztRQUNKLENBQUMsRUFBRSxDQUFDO0tBQ0EsQ0FBQztJQUNULENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztTQUNKLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQzVCLE1BQU0sQ0FBQyxDQUFDLENBQU0sRUFBRSxDQUFTLEVBQUUsQ0FBUSxFQUFFLEVBQUUsQ0FDcEMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7U0FDN0MsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ2QsT0FBTyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBQ2pELENBQUM7QUFFRCxtQ0FBbUM7QUFDbkMsbUZBQW1GO0FBRW5GLE1BQU0sVUFBVSxVQUFVLENBQ3RCLFFBQTZCLEVBQzdCLFVBRUksRUFBRTtJQUVOLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLEVBQVMsQ0FBQztJQUNwQyxtRUFBbUU7SUFDbkUsK0VBQStFO0lBQy9FLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxJQUFJLElBQUksS0FBSyxJQUFJLEVBQUU7UUFDakUsT0FBTyxJQUFJLENBQUM7S0FDZjtJQUNELElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRTtRQUNqQixJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLFFBQVEsQ0FBQyxFQUFFLENBQUM7S0FDdkM7SUFDRCxPQUFPLElBQVMsQ0FBQztBQUNyQixDQUFDO0FBRUQsTUFBTSxVQUFVLE9BQU8sQ0FDbkIsR0FBeUIsRUFDekIsVUFFSSxFQUFFO0lBRU4sT0FBTyxJQUFJLFVBQVUsQ0FBc0IsQ0FBQyxVQUFlLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxHQUFVLEVBQUUsVUFBVSxDQUFDLENBQUM7U0FDOUYsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxPQUFPLENBQU0sQ0FBQyxDQUFDLENBQUM7QUFDN0QsQ0FBQyJ9