   #! /bin/bash
    1 domain_url="<insert_domain_url>"
    2 specific_endpoint="<insert_endpoint>"
    3 specific_params="/?pageSize"
    4 specific_params_value="=<insert_value>"
    5 token="<token>"
    6
    7 ids=$(curl -sS "$domain_url$specific_endpoint$specific_params$specific_params_value" -H "Authorization: Bearer $token" | jq -r '.items[].id')
    8
    9 for id in $ids;
   10 do
   11 ▎ echo "$domain_url$specific_endpoint/$id"
   12 ▎ curl -sS "$domain_url$specific_endpoint/$id" -H "Authorization: Bearer $token" | jq '.id,.items[].description,.items[].id,.itemType' >> response.log
   13 done
   14
   15 echo "----------end----------------"
   16 echo date
