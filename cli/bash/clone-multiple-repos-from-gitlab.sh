url="https://host.remote/api/v4/groups/<ID>/projects"
avoid="example_string"
path="your_path"
read -s token
for repo in $(curl -H "PRIVATE-TOKEN: $token" $url | jq -r '.[].ssh_url_to_repo');do
    echo $repo
    substring=$( echo $repo | cut -d/ -f3 )
    echo $substring
    substring2=$( echo $substring | cut -d. -f1 )
    echo $substring2
    # echo $path$substring2
    if ! [[ $substring2 =~ $avoid ]]; then
        git clone $repo $path$substring2
        echo "$substring2 cloned!"
    # read -p "check before continue"
    fi
done