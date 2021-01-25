export default `
<html>

<body>
    Class Name <input />
    <button>Search</button>
    <div class="svg"></div>
    <script>
        const query = document.querySelector.bind(document);
        query('button').addEventListener('click', async (event) => {
            try {
                const url = new URL("http://localhost:3000");
                const className = query('input').value;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        "term": className,
                    })
                })

                console.log('response', response);
                const base64 = await response.text();
                console.log('text', base64);
                query('div.svg').innerHTML=atob(base64);
            }
            catch (e) {
                console.error(e);
            }
        })
    </script>
</body>

</html>
`;